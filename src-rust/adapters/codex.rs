use crate::adapters::ServerInfo;
use crate::types::{McpRecipe, TransportType};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodexMcpServer {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "httpUrl", skip_serializing_if = "Option::is_none")]
    pub http_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodexConfig {
    #[serde(default)]
    pub mcp_servers: HashMap<String, CodexMcpServer>,
    #[serde(flatten)]
    pub extra: HashMap<String, toml::Value>,
}

fn sanitize_server_key(name: &str) -> String {
    let base = name.split('/').last().unwrap_or(name);
    let cleaned = base
        .trim_start_matches("server-")
        .trim_end_matches("-mcp")
        .replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "_");
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "server".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn get_mcp_servers<P: AsRef<Path>>(config_path: P) -> anyhow::Result<HashMap<String, ServerInfo>> {
    let path = config_path.as_ref();
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).context("Failed to read Codex config")?;
    let config: CodexConfig = toml::from_str(&content).unwrap_or_default();

    let mut result = HashMap::new();
    for (name, server) in config.mcp_servers {
        let url = server.url.or(server.http_url);
        let recipe = McpRecipe {
            command: server.command,
            args: server.args,
            url: url.clone(),
            cwd: server.cwd,
            env: server.env,
            transport: if url.is_some() {
                Some(TransportType::Http)
            } else {
                Some(TransportType::Stdio)
            },
        };
        result.insert(name, ServerInfo { enabled: server.enabled, recipe: Some(recipe) });
    }

    Ok(result)
}

pub fn add_mcp_to_config<P: AsRef<Path>>(
    config_path: P,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    let path = config_path.as_ref();
    let mut config: CodexConfig = if path.exists() {
        let content = fs::read_to_string(path)?;
        toml::from_str(&content).unwrap_or_default()
    } else {
        CodexConfig::default()
    };

    let key = if config.mcp_servers.contains_key(server_name) {
        server_name.to_string()
    } else {
        sanitize_server_key(server_name)
    };

    let server = CodexMcpServer {
        enabled: true,
        command: recipe.command.clone(),
        args: recipe.args.clone(),
        url: recipe.url.clone(),
        http_url: None,
        cwd: recipe.cwd.clone(),
        env: recipe.env.clone(),
    };

    config.mcp_servers.insert(key.clone(), server);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let toml_str = toml::to_string_pretty(&config)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, toml_str)?;
    fs::rename(temp, path)?;

    Ok(key)
}

pub fn remove_mcp_from_config<P: AsRef<Path>>(config_path: P, server_name: &str) -> anyhow::Result<()> {
    let path = config_path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(path)?;
    let mut config: CodexConfig = toml::from_str(&content).unwrap_or_default();
    
    let key = if config.mcp_servers.contains_key(server_name) {
        server_name.to_string()
    } else {
        sanitize_server_key(server_name)
    };
    config.mcp_servers.remove(&key);

    let toml_str = toml::to_string_pretty(&config)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, toml_str)?;
    fs::rename(temp, path)?;

    Ok(())
}

pub fn set_mcp_enabled<P: AsRef<Path>>(config_path: P, server_name: &str, enabled: bool) -> anyhow::Result<()> {
    let path = config_path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(path)?;
    let mut config: CodexConfig = toml::from_str(&content).unwrap_or_default();
    
    let key = if config.mcp_servers.contains_key(server_name) {
        server_name.to_string()
    } else {
        sanitize_server_key(server_name)
    };

    if let Some(server) = config.mcp_servers.get_mut(&key) {
        server.enabled = enabled;
        let toml_str = toml::to_string_pretty(&config)?;
        let temp = format!("{}.tmp", path.display());
        fs::write(&temp, toml_str)?;
        fs::rename(temp, path)?;
    }

    Ok(())
}
