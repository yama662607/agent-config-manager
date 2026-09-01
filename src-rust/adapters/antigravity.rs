use crate::adapters::ServerInfo;
use crate::types::{McpRecipe, TransportType};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AntigravityMcpServer {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(rename = "serverUrl", skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AntigravityConfig {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: HashMap<String, AntigravityMcpServer>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

pub fn get_mcp_servers<P: AsRef<Path>>(config_path: P) -> anyhow::Result<HashMap<String, ServerInfo>> {
    let path = config_path.as_ref();
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).context("Failed to read Antigravity config")?;
    let config: AntigravityConfig = serde_json::from_str(&content).unwrap_or_default();

    let mut result = HashMap::new();
    for (name, server) in config.mcp_servers {
        let recipe = McpRecipe {
            command: server.command,
            args: server.args,
            url: server.server_url.clone(),
            cwd: server.cwd,
            env: server.env,
            transport: if server.server_url.is_some() {
                Some(TransportType::Http)
            } else {
                Some(TransportType::Stdio)
            },
        };
        result.insert(name, ServerInfo { enabled: true, recipe: Some(recipe) });
    }

    Ok(result)
}

pub fn add_mcp_to_config<P: AsRef<Path>>(
    config_path: P,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    let path = config_path.as_ref();
    let mut config: AntigravityConfig = if path.exists() {
        let content = fs::read_to_string(path)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AntigravityConfig::default()
    };

    let server = AntigravityMcpServer {
        command: recipe.command.clone(),
        args: recipe.args.clone(),
        server_url: recipe.url.clone(),
        cwd: recipe.cwd.clone(),
        env: recipe.env.clone(),
    };

    config.mcp_servers.insert(server_name.to_string(), server);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&config)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, json)?;
    fs::rename(temp, path)?;

    Ok(server_name.to_string())
}

pub fn remove_mcp_from_config<P: AsRef<Path>>(config_path: P, server_name: &str) -> anyhow::Result<()> {
    let path = config_path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(path)?;
    let mut config: AntigravityConfig = serde_json::from_str(&content).unwrap_or_default();
    config.mcp_servers.remove(server_name);

    let json = serde_json::to_string_pretty(&config)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, json)?;
    fs::rename(temp, path)?;

    Ok(())
}

pub fn set_mcp_enabled<P: AsRef<Path>>(config_path: P, server_name: &str, enabled: bool) -> anyhow::Result<()> {
    if !enabled {
        remove_mcp_from_config(config_path, server_name)?;
    }
    Ok(())
}
