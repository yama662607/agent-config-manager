use crate::adapters::{codex, grok};
use crate::paths::{
    format_home_path, get_agent_mcp_config_path, get_agent_plugins_dir, get_agent_skills_dir,
    get_catalog_plugin_dir, get_catalog_plugins_dir,
};
use crate::types::{McpRecipe, PluginPlacementState, PluginStatus, PluginWorkspaceStatus, TargetName, TransportType};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RawPluginManifest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedPluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub skills: Vec<String>,
    pub mcp_servers: HashMap<String, McpRecipe>,
    pub source_path: PathBuf,
}

/// Validate plugin ID to prevent directory traversal or invalid characters
pub fn validate_plugin_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty() {
        anyhow::bail!("Plugin ID cannot be empty");
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        anyhow::bail!("Invalid plugin ID '{}': path separators are not allowed", id);
    }
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
        anyhow::bail!("Invalid plugin ID '{}': only alphanumeric, '-', '_', '.' are allowed", id);
    }
    Ok(())
}

/// Parse plugin manifest and inspect skills / MCPs
pub fn parse_plugin_dir<P: AsRef<Path>>(plugin_dir: P) -> anyhow::Result<ParsedPluginInfo> {
    let dir = plugin_dir.as_ref();
    if !dir.exists() || !dir.is_dir() {
        anyhow::bail!("Plugin directory not found: {}", dir.display());
    }

    let id = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut name = id.clone();
    let mut description = String::new();
    let mut version = "0.1.0".to_string();

    // 1. Check manifests in priority order
    let claude_plugin_json = dir.join(".claude-plugin").join("plugin.json");
    let root_plugin_json = dir.join("plugin.json");
    let package_json = dir.join("package.json");

    let manifest_path = if claude_plugin_json.exists() {
        Some(claude_plugin_json)
    } else if root_plugin_json.exists() {
        Some(root_plugin_json)
    } else if package_json.exists() {
        Some(package_json)
    } else {
        None
    };

    if let Some(p) = manifest_path {
        if let Ok(content) = fs::read_to_string(&p) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(n) = parsed.get("name").and_then(|v| v.as_str()) {
                    name = n.to_string();
                }
                if let Some(d) = parsed.get("description").and_then(|v| v.as_str()) {
                    description = d.to_string();
                }
                if let Some(v) = parsed.get("version").and_then(|v| v.as_str()) {
                    version = v.to_string();
                }
            }
        }
    }

    // 2. Discover skills
    let mut skills = Vec::new();
    let skills_dir = dir.join("skills");
    if skills_dir.exists() && skills_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && p.join("SKILL.md").exists() {
                    skills.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }
    skills.sort();

    // 3. Discover MCP servers from .mcp.json or mcp_config.json
    let mut mcp_servers = HashMap::new();
    let dot_mcp = dir.join(".mcp.json");
    let mcp_config = dir.join("mcp_config.json");

    let mcp_path = if dot_mcp.exists() {
        Some(dot_mcp)
    } else if mcp_config.exists() {
        Some(mcp_config)
    } else {
        None
    };

    if let Some(mp) = mcp_path {
        if let Ok(content) = fs::read_to_string(&mp) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
                    for (srv_name, srv_val) in servers {
                        let command = srv_val.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let args = srv_val.get("args").and_then(|v| v.as_array()).map(|arr| {
                            arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()
                        });
                        let url = srv_val
                            .get("url")
                            .or_else(|| srv_val.get("serverUrl"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let cwd = srv_val.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string());

                        let mut env_map = HashMap::new();
                        if let Some(env_obj) = srv_val.get("env").and_then(|v| v.as_object()) {
                            for (k, v) in env_obj {
                                if let Some(val_str) = v.as_str() {
                                    env_map.insert(k.clone(), val_str.to_string());
                                }
                            }
                        }

                        let transport = if url.is_some() {
                            Some(TransportType::Http)
                        } else {
                            Some(TransportType::Stdio)
                        };

                        mcp_servers.insert(
                            srv_name.clone(),
                            McpRecipe {
                                command,
                                args,
                                url,
                                cwd,
                                env: if env_map.is_empty() { None } else { Some(env_map) },
                                transport,
                            },
                        );
                    }
                }
            }
        }
    }

    Ok(ParsedPluginInfo {
        id,
        name,
        description,
        version,
        skills,
        mcp_servers,
        source_path: dir.to_path_buf(),
    })
}

/// Create a target-native projection for Claude Code
fn project_for_claude(catalog_plugin_dir: &Path, target_plugin_dir: &Path) -> anyhow::Result<()> {
    if let Some(parent) = target_plugin_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    if target_plugin_dir.exists() || fs::symlink_metadata(target_plugin_dir).is_ok() {
        let _ = fs::remove_file(target_plugin_dir).or_else(|_| fs::remove_dir_all(target_plugin_dir));
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(catalog_plugin_dir, target_plugin_dir)?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(catalog_plugin_dir, target_plugin_dir)?;

    Ok(())
}

/// Create an isolated projection for Google Antigravity WITHOUT polluting the source repository
fn project_for_antigravity(catalog_plugin_dir: &Path, target_plugin_dir: &Path) -> anyhow::Result<()> {
    if let Some(parent) = target_plugin_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    if target_plugin_dir.exists() || fs::symlink_metadata(target_plugin_dir).is_ok() {
        let _ = fs::remove_file(target_plugin_dir).or_else(|_| fs::remove_dir_all(target_plugin_dir));
    }

    let root_plugin_json = catalog_plugin_dir.join("plugin.json");
    let claude_plugin_json = catalog_plugin_dir.join(".claude-plugin").join("plugin.json");
    let dot_mcp = catalog_plugin_dir.join(".mcp.json");
    let mcp_config = catalog_plugin_dir.join("mcp_config.json");

    // If plugin already natively conforms to Antigravity (root plugin.json exists and mcp doesn't need conversion), direct link
    if root_plugin_json.exists() && (!dot_mcp.exists() || mcp_config.exists()) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(catalog_plugin_dir, target_plugin_dir)?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(catalog_plugin_dir, target_plugin_dir)?;
        return Ok(());
    }

    // Isolated Projection: Create destination folder and link items individually, writing generated configs ONLY inside destination
    fs::create_dir_all(target_plugin_dir)?;

    if let Ok(entries) = fs::read_dir(catalog_plugin_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "plugin.json" || name_str == "mcp_config.json" {
                continue;
            }
            let src_item = entry.path();
            let dst_item = target_plugin_dir.join(&name);
            #[cfg(unix)]
            let _ = std::os::unix::fs::symlink(&src_item, &dst_item);
            #[cfg(windows)]
            {
                if src_item.is_dir() {
                    let _ = std::os::windows::fs::symlink_dir(&src_item, &dst_item);
                } else {
                    let _ = std::os::windows::fs::symlink_file(&src_item, &dst_item);
                }
            }
        }
    }

    // Isolated root plugin.json
    if root_plugin_json.exists() {
        if let Ok(content) = fs::read_to_string(&root_plugin_json) {
            let _ = fs::write(target_plugin_dir.join("plugin.json"), content);
        }
    } else if claude_plugin_json.exists() {
        if let Ok(content) = fs::read_to_string(&claude_plugin_json) {
            let _ = fs::write(target_plugin_dir.join("plugin.json"), content);
        }
    }

    // Isolated mcp_config.json
    if mcp_config.exists() {
        if let Ok(content) = fs::read_to_string(&mcp_config) {
            let _ = fs::write(target_plugin_dir.join("mcp_config.json"), content);
        }
    } else if dot_mcp.exists() {
        if let Ok(content) = fs::read_to_string(&dot_mcp) {
            let _ = fs::write(target_plugin_dir.join("mcp_config.json"), content);
        }
    }

    Ok(())
}

/// Install / Distribute a plugin to specified agent targets
pub fn plugin_install(
    project_root: &Path,
    plugin_id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginStatus> {
    validate_plugin_id(plugin_id)?;
    let catalog_plugin_dir = get_catalog_plugin_dir(plugin_id);
    if !catalog_plugin_dir.exists() {
        anyhow::bail!("Plugin '{}' not found in catalog ({})", plugin_id, catalog_plugin_dir.display());
    }

    let info = parse_plugin_dir(&catalog_plugin_dir)?;

    for &target in targets {
        match target {
            TargetName::Claude => {
                if let Some(plugins_dir) = get_agent_plugins_dir(project_root, TargetName::Claude) {
                    let dest = plugins_dir.join(plugin_id);
                    project_for_claude(&catalog_plugin_dir, &dest)?;
                }
            }
            TargetName::Antigravity => {
                if let Some(plugins_dir) = get_agent_plugins_dir(project_root, TargetName::Antigravity) {
                    let dest = plugins_dir.join(plugin_id);
                    project_for_antigravity(&catalog_plugin_dir, &dest)?;
                }
            }
            TargetName::Codex => {
                // 1. Link skills to .codex/skills/
                let skills_target_dir = get_agent_skills_dir(project_root, TargetName::Codex);
                fs::create_dir_all(&skills_target_dir)?;
                for skill_name in &info.skills {
                    let src_skill = catalog_plugin_dir.join("skills").join(skill_name);
                    let dst_skill = skills_target_dir.join(skill_name);
                    if dst_skill.exists() || fs::symlink_metadata(&dst_skill).is_ok() {
                        let meta = fs::symlink_metadata(&dst_skill)?;
                        if meta.file_type().is_symlink() {
                            let _ = fs::remove_file(&dst_skill);
                        } else {
                            // Protect user's local directory from accidental deletion
                            continue;
                        }
                    }
                    #[cfg(unix)]
                    let _ = std::os::unix::fs::symlink(&src_skill, &dst_skill);
                    #[cfg(windows)]
                    let _ = std::os::windows::fs::symlink_dir(&src_skill, &dst_skill);
                }

                // 2. Inject MCP servers into Codex config.toml
                let codex_config_path = get_agent_mcp_config_path(project_root, TargetName::Codex);
                for (name, recipe) in &info.mcp_servers {
                    codex::add_mcp_to_config(&codex_config_path, name, recipe)
                        .with_context(|| format!("Failed to inject MCP server '{}' into Codex config", name))?;
                }
            }
            TargetName::Grok => {
                // 1. Register plugin's skills/ directory in Grok config.toml
                let grok_config_path = get_agent_mcp_config_path(project_root, TargetName::Grok);
                let plugin_skills_dir = catalog_plugin_dir.join("skills");
                if plugin_skills_dir.exists() {
                    grok::register_skill_path(&grok_config_path, &plugin_skills_dir.to_string_lossy())
                        .with_context(|| "Failed to register skill path into Grok config")?;
                }

                // 2. Inject MCP servers into Grok config.toml
                for (name, recipe) in &info.mcp_servers {
                    grok::add_mcp_to_config(&grok_config_path, name, recipe)
                        .with_context(|| format!("Failed to inject MCP server '{}' into Grok config", name))?;
                }
            }
        }
    }

    get_plugin_status(project_root, plugin_id, targets)
}

/// Remove / Uninstall a plugin from specified agent targets
pub fn plugin_remove(
    project_root: &Path,
    plugin_id: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    validate_plugin_id(plugin_id)?;
    let catalog_plugin_dir = get_catalog_plugin_dir(plugin_id);
    let info = parse_plugin_dir(&catalog_plugin_dir).ok();

    for &target in targets {
        match target {
            TargetName::Claude => {
                if let Some(plugins_dir) = get_agent_plugins_dir(project_root, TargetName::Claude) {
                    let dest = plugins_dir.join(plugin_id);
                    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
                        let _ = fs::remove_file(&dest).or_else(|_| fs::remove_dir_all(&dest));
                    }
                }
            }
            TargetName::Antigravity => {
                if let Some(plugins_dir) = get_agent_plugins_dir(project_root, TargetName::Antigravity) {
                    let dest = plugins_dir.join(plugin_id);
                    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
                        let _ = fs::remove_file(&dest).or_else(|_| fs::remove_dir_all(&dest));
                    }
                }
            }
            TargetName::Codex => {
                if let Some(ref inf) = info {
                    // Remove linked skills safely (only if pointing to this plugin)
                    let skills_target_dir = get_agent_skills_dir(project_root, TargetName::Codex);
                    for skill_name in &inf.skills {
                        let dst_skill = skills_target_dir.join(skill_name);
                        if let Ok(meta) = fs::symlink_metadata(&dst_skill) {
                            if meta.file_type().is_symlink() {
                                let _ = fs::remove_file(&dst_skill);
                            }
                        }
                    }
                    // Remove injected MCP servers
                    let codex_config_path = get_agent_mcp_config_path(project_root, TargetName::Codex);
                    for name in inf.mcp_servers.keys() {
                        let _ = codex::remove_mcp_from_config(&codex_config_path, name);
                    }
                }
            }
            TargetName::Grok => {
                if let Some(ref inf) = info {
                    let grok_config_path = get_agent_mcp_config_path(project_root, TargetName::Grok);
                    let plugin_skills_dir = catalog_plugin_dir.join("skills");
                    if plugin_skills_dir.exists() {
                        let _ = grok::unregister_skill_path(&grok_config_path, &plugin_skills_dir.to_string_lossy());
                    }
                    for name in inf.mcp_servers.keys() {
                        let _ = grok::remove_mcp_from_config(&grok_config_path, name);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Link or add an external plugin directory into the catalog (~/.acm/plugins/<id>)
pub fn plugin_add_to_catalog<P: AsRef<Path>>(source_path: P, custom_id: Option<&str>) -> anyhow::Result<String> {
    let src = source_path.as_ref();
    if !src.exists() || !src.is_dir() {
        anyhow::bail!("Plugin source directory not found: {}", src.display());
    }

    // Canonicalize to guarantee absolute path and prevent dangling relative symlinks
    let abs_src = src.canonicalize().with_context(|| format!("Failed to canonicalize plugin path: {}", src.display()))?;

    let parsed = parse_plugin_dir(&abs_src)?;
    let id = custom_id.unwrap_or(&parsed.id).to_string();
    validate_plugin_id(&id)?;

    let catalog_plugins = get_catalog_plugins_dir();
    fs::create_dir_all(&catalog_plugins)?;

    let target = catalog_plugins.join(&id);
    if target.exists() || fs::symlink_metadata(&target).is_ok() {
        if let Ok(meta) = fs::symlink_metadata(&target) {
            if meta.file_type().is_symlink() {
                fs::remove_file(&target)?;
            } else {
                anyhow::bail!("Directory '{}' already exists in catalog and is not a symlink", id);
            }
        }
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(&abs_src, &target)?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&abs_src, &target)?;

    Ok(id)
}

/// Unlink / remove a plugin from the catalog (~/.acm/plugins/<id>)
pub fn plugin_unlink_from_catalog(plugin_id: &str) -> anyhow::Result<()> {
    validate_plugin_id(plugin_id)?;
    let target = get_catalog_plugin_dir(plugin_id);
    if !target.exists() && fs::symlink_metadata(&target).is_err() {
        anyhow::bail!("Plugin '{}' is not registered in catalog", plugin_id);
    }

    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            fs::remove_file(&target)?;
        } else {
            anyhow::bail!("Plugin directory '{}' in catalog is a real directory, not a symlink. Remove manually if intended.", plugin_id);
        }
    }

    Ok(())
}

/// Get detailed status for a single plugin
pub fn get_plugin_status(
    project_root: &Path,
    plugin_id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginStatus> {
    validate_plugin_id(plugin_id)?;
    let catalog_plugin_dir = get_catalog_plugin_dir(plugin_id);
    let info = parse_plugin_dir(&catalog_plugin_dir)?;

    let mut placement = HashMap::new();
    let mut active_targets = Vec::new();

    for &target in targets {
        let state = match target {
            TargetName::Claude => {
                let dest = get_agent_plugins_dir(project_root, TargetName::Claude).map(|d| d.join(plugin_id));
                if let Some(d) = dest {
                    if d.exists() {
                        PluginPlacementState::NativeLinked
                    } else if fs::symlink_metadata(&d).is_ok() {
                        PluginPlacementState::Broken
                    } else {
                        PluginPlacementState::Missing
                    }
                } else {
                    PluginPlacementState::Missing
                }
            }
            TargetName::Antigravity => {
                let dest = get_agent_plugins_dir(project_root, TargetName::Antigravity).map(|d| d.join(plugin_id));
                if let Some(d) = dest {
                    if d.exists() {
                        PluginPlacementState::ConvertedLinked
                    } else if fs::symlink_metadata(&d).is_ok() {
                        PluginPlacementState::Broken
                    } else {
                        PluginPlacementState::Missing
                    }
                } else {
                    PluginPlacementState::Missing
                }
            }
            TargetName::Codex => {
                let skills_dir = get_agent_skills_dir(project_root, TargetName::Codex);
                let any_skill_present = !info.skills.is_empty() && info.skills.iter().any(|s| skills_dir.join(s).exists());
                let codex_config = get_agent_mcp_config_path(project_root, TargetName::Codex);
                let mcps = codex::get_mcp_servers(&codex_config).unwrap_or_default();
                // Check sanitized key as well as original key
                let any_mcp_present = !info.mcp_servers.is_empty() && info.mcp_servers.keys().any(|k| {
                    mcps.contains_key(k) || mcps.contains_key(&codex::sanitize_server_key(k))
                });

                if any_skill_present || any_mcp_present {
                    PluginPlacementState::Injected
                } else {
                    PluginPlacementState::Missing
                }
            }
            TargetName::Grok => {
                let grok_config = get_agent_mcp_config_path(project_root, TargetName::Grok);
                let mcps = grok::get_mcp_servers(&grok_config).unwrap_or_default();
                let any_mcp_present = !info.mcp_servers.is_empty() && info.mcp_servers.keys().any(|k| {
                    mcps.contains_key(k) || mcps.contains_key(&grok::sanitize_server_key(k))
                });

                let plugin_skills_dir = catalog_plugin_dir.join("skills");
                let skill_registered = if plugin_skills_dir.exists() {
                    grok::is_skill_path_registered(&grok_config, &plugin_skills_dir.to_string_lossy()).unwrap_or(false)
                } else {
                    false
                };

                if any_mcp_present || skill_registered {
                    PluginPlacementState::Injected
                } else {
                    PluginPlacementState::Missing
                }
            }
        };

        if state != PluginPlacementState::Missing && state != PluginPlacementState::Broken {
            active_targets.push(target);
        }
        placement.insert(target, state);
    }

    let is_enabled = !active_targets.is_empty();

    Ok(PluginStatus {
        id: plugin_id.to_string(),
        name: info.name,
        description: info.description,
        version: info.version,
        enabled: is_enabled,
        targets: active_targets,
        placement,
        skills: info.skills,
        mcp_servers: info.mcp_servers.into_keys().collect(),
        source_path: format_home_path(&catalog_plugin_dir),
    })
}

/// Discover and get status for all plugins in catalog and workspace
pub fn get_plugin_workspace_status(
    project_root: &Path,
    targets: &[TargetName],
) -> anyhow::Result<PluginWorkspaceStatus> {
    let catalog_plugins = get_catalog_plugins_dir();
    let mut plugin_ids = Vec::new();

    if catalog_plugins.exists() {
        if let Ok(entries) = fs::read_dir(&catalog_plugins) {
            for entry in entries.flatten() {
                let p = entry.path();
                let is_dir = if entry.file_type().map_or(false, |ft| ft.is_symlink()) {
                    p.exists() && fs::metadata(&p).map_or(false, |m| m.is_dir())
                } else {
                    p.is_dir()
                };
                if is_dir {
                    plugin_ids.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }

    plugin_ids.sort();
    plugin_ids.dedup();

    let mut plugins = Vec::new();
    let mut enabled_count = 0;

    for id in &plugin_ids {
        if let Ok(status) = get_plugin_status(project_root, id, targets) {
            if status.enabled {
                enabled_count += 1;
            }
            plugins.push(status);
        }
    }

    Ok(PluginWorkspaceStatus {
        project_root: format_home_path(project_root),
        total_count: plugins.len(),
        enabled_count,
        plugins,
    })
}
