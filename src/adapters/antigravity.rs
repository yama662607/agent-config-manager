pub use super::sanitize_server_key;
use crate::types::{McpRecipe, TargetName};
use std::path::Path;

pub fn get_mcp_servers<P: AsRef<Path>>(
    path: P,
) -> anyhow::Result<std::collections::HashMap<String, super::ServerInfo>> {
    super::get_mcp_servers(TargetName::Antigravity, path)
}
pub fn add_mcp_to_config<P: AsRef<Path>>(
    path: P,
    name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    super::add_mcp_to_config(TargetName::Antigravity, path, name, recipe)
}
pub fn remove_mcp_from_config<P: AsRef<Path>>(path: P, name: &str) -> anyhow::Result<()> {
    super::remove_mcp_from_config(TargetName::Antigravity, path, name)
}
pub fn set_mcp_enabled<P: AsRef<Path>>(path: P, name: &str, enabled: bool) -> anyhow::Result<()> {
    super::set_mcp_enabled(TargetName::Antigravity, path, name, enabled)
}
