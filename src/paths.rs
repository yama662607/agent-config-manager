use crate::types::TargetName;
use std::path::{Path, PathBuf};

/// Get the home directory path
pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Format absolute path with ~ for user home
pub fn format_home_path<P: AsRef<Path>>(path: P) -> String {
    let path_ref = path.as_ref();
    let home = home_dir();
    if path_ref == home {
        "~".to_string()
    } else if let Ok(stripped) = path_ref.strip_prefix(&home) {
        format!("~/{}", stripped.display())
    } else {
        path_ref.display().to_string()
    }
}

/// Get the catalog directory path (~/.acm by default, or ACM_CATALOG_DIR env)
pub fn get_catalog_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ACM_CATALOG_DIR") {
        if !dir.is_empty() {
            return absolute_path(&dir);
        }
    }
    if let Ok(config) = read_acm_config() {
        if let Some(dir) = config
            .get("catalog_dir")
            .and_then(toml::Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return absolute_path(dir);
        }
    }
    get_state_dir()
}

pub fn get_state_dir() -> PathBuf {
    home_dir().join(".acm")
}

pub fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        home_dir()
    } else if let Some(rest) = value.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(value)
    }
}

pub fn absolute_path(value: &str) -> PathBuf {
    let path = expand_home(value);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}

pub fn read_acm_config() -> anyhow::Result<toml::Table> {
    let path = get_state_dir().join("config.toml");
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(toml::from_str(&raw)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(toml::Table::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn default_targets() -> anyhow::Result<Vec<TargetName>> {
    let config = read_acm_config()?;
    if let Some(value) = config.get("default_targets") {
        let values = value
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("default_targets must be an array"))?;
        if !values.is_empty() {
            return values
                .iter()
                .map(|v| {
                    v.as_str()
                        .ok_or_else(|| anyhow::anyhow!("default_targets must contain strings"))?
                        .parse()
                        .map_err(anyhow::Error::msg)
                })
                .collect();
        }
    }
    Ok(TargetName::all().to_vec())
}

pub fn discover_project(start: &Path) -> anyhow::Result<PathBuf> {
    let start = start.canonicalize()?;
    if is_home_scope(&start) || home_dir().parent() == Some(start.as_path()) {
        anyhow::bail!("Use --home to manage home configuration, or enter a project directory");
    }
    for candidate in start.ancestors() {
        if is_home_scope(candidate) {
            break;
        }
        if candidate.join(".git").exists()
            || [
                ".mcp.json",
                ".codex/config.toml",
                ".grok/config.toml",
                ".agents/mcp_config.json",
            ]
            .iter()
            .any(|marker| candidate.join(marker).is_file())
        {
            return Ok(candidate.to_path_buf());
        }
    }
    // Standalone directories have always been valid explicit project scopes.
    Ok(start)
}

pub fn warn_unsupported_scope(root: &Path, targets: &[TargetName], kind: &str) {
    if !is_home_scope(root) && targets.contains(&TargetName::Antigravity) {
        eprintln!("Warning: the Antigravity CLI does not read project-scope {kind}; use --home. Project files may be used by other clients.");
    }
}

/// Get the catalog.toml path
pub fn get_catalog_path() -> PathBuf {
    get_catalog_dir().join("catalog.toml")
}

/// Get the catalog skills directory path (~/.acm/skills)
pub fn get_catalog_skills_dir() -> PathBuf {
    get_catalog_dir().join("skills")
}

/// Get a specific skill directory in catalog (~/.acm/skills/<id>)
pub fn get_catalog_skill_dir(id: &str) -> PathBuf {
    get_catalog_skills_dir().join(id)
}

/// Get skills-metadata.toml path
pub fn get_skills_metadata_path() -> PathBuf {
    get_catalog_dir().join("skills-metadata.toml")
}

/// Get mcps-metadata.toml path
pub fn get_mcps_metadata_path() -> PathBuf {
    get_catalog_dir().join("mcps-metadata.toml")
}

/// Get the catalog plugins directory path (~/.acm/plugins)
pub fn get_catalog_plugins_dir() -> PathBuf {
    get_catalog_dir().join("plugins")
}

/// Get a specific plugin directory in catalog (~/.acm/plugins/<id>)
pub fn get_catalog_plugin_dir(id: &str) -> PathBuf {
    get_catalog_plugins_dir().join(id)
}

/// Get the agent plugins directory for Claude or Antigravity
pub fn get_agent_plugins_dir<P: AsRef<Path>>(
    project_root: P,
    target: TargetName,
) -> Option<PathBuf> {
    let root = project_root.as_ref();
    if is_home_scope(root) {
        let home = home_dir();
        match target {
            TargetName::Claude => Some(home.join(".claude").join("plugins")),
            TargetName::Antigravity => Some(home.join(".gemini").join("config").join("plugins")),
            _ => None,
        }
    } else {
        match target {
            TargetName::Claude => Some(root.join(".claude").join("plugins")),
            TargetName::Antigravity => Some(root.join(".agents").join("plugins")),
            _ => None,
        }
    }
}

/// Whether the given path is the user's home directory
pub fn is_home_scope<P: AsRef<Path>>(path: P) -> bool {
    let p = path.as_ref();
    if let Ok(canon) = p.canonicalize() {
        if let Ok(home_canon) = home_dir().canonicalize() {
            return canon == home_canon;
        }
    }
    p == home_dir()
}

/// Get the skill directory for a specific target in a project or globally
pub fn get_agent_skills_dir<P: AsRef<Path>>(project_root: P, target: TargetName) -> PathBuf {
    let root = project_root.as_ref();
    if is_home_scope(root) {
        let home = home_dir();
        match target {
            TargetName::Claude => home.join(".claude").join("skills"),
            TargetName::Codex => home.join(".codex").join("skills"),
            TargetName::Antigravity => home.join(".gemini").join("config").join("skills"),
            TargetName::Grok => home.join(".grok").join("skills"),
        }
    } else {
        match target {
            TargetName::Claude => root.join(".claude").join("skills"),
            TargetName::Codex => root.join(".codex").join("skills"),
            TargetName::Antigravity => root.join(".agents").join("skills"),
            TargetName::Grok => root.join(".grok").join("skills"),
        }
    }
}

/// Get the skill directory for a specific skill name and target
pub fn get_skill_path<P: AsRef<Path>>(
    project_root: P,
    target: TargetName,
    skill_name: &str,
) -> PathBuf {
    get_agent_skills_dir(project_root, target).join(skill_name)
}

/// Get the MCP config file path for a target in a project or globally
pub fn get_agent_mcp_config_path<P: AsRef<Path>>(project_root: P, target: TargetName) -> PathBuf {
    let root = project_root.as_ref();
    if is_home_scope(root) {
        let home = home_dir();
        match target {
            TargetName::Claude => home.join(".claude.json"),
            TargetName::Codex => home.join(".codex").join("config.toml"),
            TargetName::Antigravity => home.join(".gemini").join("config").join("mcp_config.json"),
            TargetName::Grok => home.join(".grok").join("config.toml"),
        }
    } else {
        match target {
            TargetName::Claude => root.join(".mcp.json"),
            TargetName::Codex => root.join(".codex").join("config.toml"),
            TargetName::Antigravity => root.join(".agents").join("mcp_config.json"),
            TargetName::Grok => root.join(".grok").join("config.toml"),
        }
    }
}
