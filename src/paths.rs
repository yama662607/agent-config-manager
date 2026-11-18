use crate::types::{ProviderKind, TargetName};
use std::borrow::Borrow;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetProfile {
    pub name: TargetName,
    pub provider: ProviderKind,
    pub config_dir: PathBuf,
    pub explicit_config_dir: bool,
    pub command: Option<String>,
    pub dsh_profiles: Vec<String>,
    pub aliases: Vec<String>,
}

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

fn default_provider_config_dir(provider: ProviderKind) -> (PathBuf, bool) {
    let home = home_dir();
    match provider {
        ProviderKind::Claude => {
            if let Ok(val) = std::env::var("CLAUDE_CONFIG_DIR") {
                if !val.trim().is_empty() {
                    return (expand_home(val.trim()), true);
                }
            }
            (home.join(".claude"), false)
        }
        ProviderKind::Codex => {
            if let Ok(val) = std::env::var("CODEX_HOME") {
                if !val.trim().is_empty() {
                    return (expand_home(val.trim()), true);
                }
            }
            (home.join(".codex"), false)
        }
        ProviderKind::Antigravity => (home.join(".gemini").join("config"), false),
        ProviderKind::Grok => (home.join(".grok"), false),
        ProviderKind::Dsh => {
            if let Ok(val) = std::env::var("DSH_HOME") {
                if !val.trim().is_empty() {
                    return (expand_home(val.trim()), true);
                }
            }
            (home.join(".dsh"), false)
        }
    }
}

fn default_profile_for_builtin(provider: ProviderKind) -> TargetProfile {
    let (config_dir, explicit_config_dir) = default_provider_config_dir(provider);
    let name = match provider {
        ProviderKind::Claude => TargetName::Claude,
        ProviderKind::Codex => TargetName::Codex,
        ProviderKind::Antigravity => TargetName::Antigravity,
        ProviderKind::Grok => TargetName::Grok,
        ProviderKind::Dsh => TargetName::Dsh,
    };
    TargetProfile {
        name,
        provider,
        config_dir,
        explicit_config_dir,
        command: None,
        dsh_profiles: Vec::new(),
        aliases: Vec::new(),
    }
}

pub fn read_target_profiles() -> anyhow::Result<Vec<TargetProfile>> {
    let config = read_acm_config()?;
    let mut profiles = Vec::new();
    let Some(targets_val) = config.get("targets") else {
        return Ok(profiles);
    };
    let table = targets_val
        .as_table()
        .ok_or_else(|| anyhow::anyhow!("targets in config.toml must be a table"))?;

    let mut keys: Vec<&String> = table.keys().collect();
    keys.sort();

    for key in keys {
        let normalized_name = key.trim().to_lowercase();
        if normalized_name.is_empty() {
            anyhow::bail!("targets entry name cannot be empty");
        }
        let entry = table[key]
            .as_table()
            .ok_or_else(|| anyhow::anyhow!("targets.{} must be a table", key))?;

        let provider: ProviderKind = if let Some(p) = entry.get("provider") {
            let p_str = p
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.provider must be a string", key))?;
            p_str
                .parse()
                .map_err(|e| anyhow::anyhow!("targets.{}.provider: {}", key, e))?
        } else if let Ok(kind) = normalized_name.parse::<ProviderKind>() {
            kind
        } else {
            anyhow::bail!("targets.{}.provider is required", key);
        };

        let config_dir_val = entry.get("config_dir").or_else(|| entry.get("home_dir"));
        let (config_dir, explicit_config_dir) = if let Some(val) = config_dir_val {
            let raw = val
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.config_dir must be a string", key))?;
            if raw.trim().is_empty() {
                anyhow::bail!("targets.{}.config_dir cannot be empty", key);
            }
            (expand_home(raw.trim()), true)
        } else {
            default_provider_config_dir(provider)
        };

        let command = if let Some(val) = entry.get("command") {
            let s = val
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.command must be a string", key))?;
            if s.trim().is_empty() {
                None
            } else {
                Some(s.trim().to_string())
            }
        } else {
            None
        };

        let mut dsh_profiles = Vec::new();
        if let Some(val) = entry.get("profile") {
            let s = val
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.profile must be a string", key))?;
            if !s.trim().is_empty() {
                dsh_profiles.push(s.trim().to_string());
            }
        }
        if let Some(val) = entry.get("profiles") {
            let arr = val
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.profiles must be an array", key))?;
            for item in arr {
                let s = item.as_str().ok_or_else(|| {
                    anyhow::anyhow!("targets.{}.profiles must contain strings", key)
                })?;
                if !s.trim().is_empty() && !dsh_profiles.iter().any(|p| p == s.trim()) {
                    dsh_profiles.push(s.trim().to_string());
                }
            }
        }

        let mut aliases = Vec::new();
        if let Some(val) = entry.get("aliases") {
            let arr = val
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("targets.{}.aliases must be an array", key))?;
            for item in arr {
                let s = item.as_str().ok_or_else(|| {
                    anyhow::anyhow!("targets.{}.aliases must contain strings", key)
                })?;
                let alias = s.trim().to_lowercase();
                if !alias.is_empty() && !aliases.contains(&alias) {
                    aliases.push(alias);
                }
            }
        }

        profiles.push(TargetProfile {
            name: TargetName::custom(normalized_name),
            provider,
            config_dir,
            explicit_config_dir,
            command,
            dsh_profiles,
            aliases,
        });
    }

    Ok(profiles)
}

pub fn resolve_configured_target(input: &str) -> Result<Option<TargetName>, String> {
    let normalized = input.trim().to_lowercase();
    let profiles = read_target_profiles().map_err(|e| e.to_string())?;
    for profile in profiles {
        if profile.name.as_str() == normalized || profile.aliases.iter().any(|a| a == &normalized) {
            return Ok(Some(profile.name));
        }
    }
    Ok(None)
}

pub fn configured_target_names() -> anyhow::Result<Vec<String>> {
    Ok(read_target_profiles()?
        .into_iter()
        .map(|p| p.name.as_str().to_string())
        .collect())
}

pub fn all_targets() -> anyhow::Result<Vec<TargetName>> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for t in TargetName::builtin_all() {
        if seen.insert(t.as_str().to_string()) {
            result.push(t.clone());
        }
    }
    for profile in read_target_profiles()? {
        if seen.insert(profile.name.as_str().to_string()) {
            result.push(profile.name);
        }
    }
    Ok(result)
}

pub fn resolve_target_provider(target: &TargetName) -> anyhow::Result<ProviderKind> {
    if let Ok(kind) = target.as_str().parse::<ProviderKind>() {
        if let Ok(profiles) = read_target_profiles() {
            if let Some(found) = profiles.into_iter().find(|p| &p.name == target) {
                return Ok(found.provider);
            }
        }
        return Ok(kind);
    }
    let profiles = read_target_profiles()?;
    if let Some(found) = profiles.into_iter().find(|p| &p.name == target) {
        return Ok(found.provider);
    }
    anyhow::bail!("Unknown target: {}", target)
}

pub fn resolve_target_profile(target: &TargetName) -> anyhow::Result<TargetProfile> {
    let profiles = read_target_profiles()?;
    if let Some(found) = profiles.into_iter().find(|p| &p.name == target) {
        return Ok(found);
    }
    if let Ok(kind) = target.as_str().parse::<ProviderKind>() {
        return Ok(default_profile_for_builtin(kind));
    }
    anyhow::bail!("Unknown target: {}", target)
}

pub fn discover_dsh_profiles(profile: &TargetProfile) -> Vec<(String, PathBuf)> {
    let profiles_root = profile.config_dir.join("profiles");
    if !profile.dsh_profiles.is_empty() {
        return profile
            .dsh_profiles
            .iter()
            .map(|name| (name.clone(), profiles_root.join(name)))
            .collect();
    }
    let Ok(entries) = std::fs::read_dir(&profiles_root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.join("cordis.patch.yml").is_file()
            || path.join("cordis.yml").is_file()
            || path.join("package.json").is_file()
        {
            if let Some(name) = entry.file_name().to_str() {
                found.push((name.to_string(), path));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

pub fn dsh_mcp_config_paths(profile: &TargetProfile) -> Vec<(String, PathBuf)> {
    discover_dsh_profiles(profile)
        .into_iter()
        .map(|(name, dir)| (name, dir.join("cordis.patch.yml")))
        .collect()
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
    all_targets()
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
            || candidate.join(".dsh").join("skills").is_dir()
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
    if !is_home_scope(root) {
        if targets
            .iter()
            .any(|t| t.provider_kind() == ProviderKind::Antigravity)
        {
            eprintln!("Warning: the Antigravity CLI does not read project-scope {kind}; use --home. Project files may be used by other clients.");
        }
        if kind == "MCP"
            && targets
                .iter()
                .any(|t| t.provider_kind() == ProviderKind::Dsh)
        {
            eprintln!("Warning: dsh does not support project-scope MCP; use --home.");
        }
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

/// Get the agent plugins directory for Claude, Antigravity, or dsh
pub fn get_agent_plugins_dir<P: AsRef<Path>, T: Borrow<TargetName>>(
    project_root: P,
    target: T,
) -> Option<PathBuf> {
    let root = project_root.as_ref();
    let target = target.borrow();
    let profile = resolve_target_profile(target).ok();
    let provider = profile
        .as_ref()
        .map(|p| p.provider)
        .unwrap_or_else(|| target.provider_kind());

    if is_home_scope(root) {
        let config_dir = profile
            .map(|p| p.config_dir)
            .unwrap_or_else(|| default_provider_config_dir(provider).0);
        match provider {
            ProviderKind::Claude => Some(config_dir.join("plugins")),
            ProviderKind::Antigravity => Some(config_dir.join("plugins")),
            ProviderKind::Dsh => Some(config_dir.join("profiles")),
            _ => None,
        }
    } else {
        match provider {
            ProviderKind::Claude => Some(root.join(".claude").join("plugins")),
            ProviderKind::Antigravity => Some(root.join(".agents").join("plugins")),
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
pub fn get_agent_skills_dir<P: AsRef<Path>, T: Borrow<TargetName>>(
    project_root: P,
    target: T,
) -> PathBuf {
    let root = project_root.as_ref();
    let target = target.borrow();
    let profile = resolve_target_profile(target).ok();
    let provider = profile
        .as_ref()
        .map(|p| p.provider)
        .unwrap_or_else(|| target.provider_kind());

    if is_home_scope(root) {
        let config_dir = profile
            .map(|p| p.config_dir)
            .unwrap_or_else(|| default_provider_config_dir(provider).0);
        config_dir.join("skills")
    } else {
        match provider {
            ProviderKind::Claude => root.join(".claude").join("skills"),
            ProviderKind::Codex => root.join(".codex").join("skills"),
            ProviderKind::Antigravity => root.join(".agents").join("skills"),
            ProviderKind::Grok => root.join(".grok").join("skills"),
            ProviderKind::Dsh => root.join(".dsh").join("skills"),
        }
    }
}

/// Get the skill directory for a specific skill name and target
pub fn get_skill_path<P: AsRef<Path>, T: Borrow<TargetName>>(
    project_root: P,
    target: T,
    skill_name: &str,
) -> PathBuf {
    get_agent_skills_dir(project_root, target).join(skill_name)
}

/// Get the MCP config file path for a target in a project or globally
pub fn get_agent_mcp_config_path<P: AsRef<Path>, T: Borrow<TargetName>>(
    project_root: P,
    target: T,
) -> PathBuf {
    let root = project_root.as_ref();
    let target = target.borrow();
    let profile = resolve_target_profile(target).ok();
    let provider = profile
        .as_ref()
        .map(|p| p.provider)
        .unwrap_or_else(|| target.provider_kind());

    if is_home_scope(root) {
        let home = home_dir();
        let config_dir = profile
            .as_ref()
            .map(|p| p.config_dir.clone())
            .unwrap_or_else(|| default_provider_config_dir(provider).0);
        match provider {
            ProviderKind::Claude => {
                if config_dir == home.join(".claude") {
                    home.join(".claude.json")
                } else {
                    config_dir.join(".claude.json")
                }
            }
            ProviderKind::Codex => config_dir.join("config.toml"),
            ProviderKind::Antigravity => config_dir.join("mcp_config.json"),
            ProviderKind::Grok => config_dir.join("config.toml"),
            ProviderKind::Dsh => {
                if let Some(ref p) = profile {
                    if let Some((_, first)) = dsh_mcp_config_paths(p).into_iter().next() {
                        return first;
                    }
                }
                config_dir
                    .join("profiles")
                    .join("default")
                    .join("cordis.patch.yml")
            }
        }
    } else {
        match provider {
            ProviderKind::Claude => root.join(".mcp.json"),
            ProviderKind::Codex => root.join(".codex").join("config.toml"),
            ProviderKind::Antigravity => root.join(".agents").join("mcp_config.json"),
            ProviderKind::Grok => root.join(".grok").join("config.toml"),
            ProviderKind::Dsh => root.join(".dsh").join("cordis.patch.yml"),
        }
    }
}
