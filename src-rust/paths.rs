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
        PathBuf::from(dir)
    } else {
        home_dir().join(".acm")
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
pub fn get_skill_path<P: AsRef<Path>>(project_root: P, target: TargetName, skill_name: &str) -> PathBuf {
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
