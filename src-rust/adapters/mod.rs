pub mod claude;
pub mod codex;
pub mod antigravity;
pub mod grok;

use crate::types::{McpRecipe, TargetName};
use std::collections::HashMap;
use std::path::Path;

/// Information about an MCP server configured in a target
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfo {
    pub enabled: bool,
    pub recipe: Option<McpRecipe>,
}

/// Read MCP servers from a native target config
pub fn get_mcp_servers<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
) -> anyhow::Result<HashMap<String, ServerInfo>> {
    let p = config_path.as_ref();
    if !p.exists() {
        return Ok(HashMap::new());
    }

    match target {
        TargetName::Claude => claude::get_mcp_servers(p),
        TargetName::Codex => codex::get_mcp_servers(p),
        TargetName::Antigravity => antigravity::get_mcp_servers(p),
        TargetName::Grok => grok::get_mcp_servers(p),
    }
}

/// Add an MCP server to a native target config
pub fn add_mcp_to_config<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    match target {
        TargetName::Claude => claude::add_mcp_to_config(config_path, server_name, recipe),
        TargetName::Codex => codex::add_mcp_to_config(config_path, server_name, recipe),
        TargetName::Antigravity => antigravity::add_mcp_to_config(config_path, server_name, recipe),
        TargetName::Grok => grok::add_mcp_to_config(config_path, server_name, recipe),
    }
}

/// Remove an MCP server from a native target config
pub fn remove_mcp_from_config<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    server_name: &str,
) -> anyhow::Result<()> {
    match target {
        TargetName::Claude => claude::remove_mcp_from_config(config_path, server_name),
        TargetName::Codex => codex::remove_mcp_from_config(config_path, server_name),
        TargetName::Antigravity => antigravity::remove_mcp_from_config(config_path, server_name),
        TargetName::Grok => grok::remove_mcp_from_config(config_path, server_name),
    }
}

/// Enable/Disable an MCP server in a native target config
pub fn set_mcp_enabled<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    server_name: &str,
    enabled: bool,
) -> anyhow::Result<()> {
    match target {
        TargetName::Claude => claude::set_mcp_enabled(config_path, server_name, enabled),
        TargetName::Codex => codex::set_mcp_enabled(config_path, server_name, enabled),
        TargetName::Antigravity => antigravity::set_mcp_enabled(config_path, server_name, enabled),
        TargetName::Grok => grok::set_mcp_enabled(config_path, server_name, enabled),
    }
}
