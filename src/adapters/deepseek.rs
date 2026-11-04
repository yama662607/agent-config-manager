pub use super::sanitize_server_key;
use crate::storage::atomic_write;
use crate::types::{McpRecipe, TargetName};
use anyhow::{bail, Context};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

pub fn get_mcp_servers<P: AsRef<Path>>(
    path: P,
) -> anyhow::Result<std::collections::HashMap<String, super::ServerInfo>> {
    let raw = raw_servers(path.as_ref())?;
    let mut result = HashMap::new();
    for (name, server) in raw {
        let enabled = server
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let recipe = super::recipe_from_native(&server)?;
        result.insert(
            name,
            super::ServerInfo {
                enabled,
                recipe: Some(recipe),
            },
        );
    }
    Ok(result)
}

pub fn add_mcp_to_config<P: AsRef<Path>>(
    path: P,
    name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    super::add_mcp_to_config(TargetName::DeepSeek, path, name, recipe)
}

pub fn remove_mcp_from_config<P: AsRef<Path>>(path: P, name: &str) -> anyhow::Result<()> {
    super::remove_mcp_from_config(TargetName::DeepSeek, path, name)
}

pub fn set_mcp_enabled<P: AsRef<Path>>(path: P, name: &str, enabled: bool) -> anyhow::Result<()> {
    super::set_mcp_enabled(TargetName::DeepSeek, path, name, enabled)
}

fn read_patch_list(path: &Path) -> anyhow::Result<Vec<serde_yaml::Value>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        std::fs::read_to_string(path).with_context(|| format!("Cannot read {}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    match serde_yaml::from_str::<serde_yaml::Value>(&content) {
        Ok(serde_yaml::Value::Sequence(seq)) => Ok(seq),
        Ok(serde_yaml::Value::Null) => Ok(Vec::new()),
        Ok(_) => bail!("Expected a YAML list in {}", path.display()),
        Err(e) => bail!("Invalid YAML in {}: {e}", path.display()),
    }
}

fn write_patch_list(path: &Path, list: &[serde_yaml::Value]) -> anyhow::Result<()> {
    let yaml_str = serde_yaml::to_string(list)?;
    atomic_write(path, yaml_str.as_bytes())
}

fn is_matching_entry(val: &serde_yaml::Value, expected_id: &str, server_name: &str) -> bool {
    if let Some(id_str) = val.get("id").and_then(serde_yaml::Value::as_str) {
        if id_str == expected_id || id_str == server_name {
            return true;
        }
    }
    if let Some(name) = val
        .get("config")
        .and_then(|c| c.get("serverName"))
        .and_then(serde_yaml::Value::as_str)
    {
        if name == server_name {
            return true;
        }
    }
    false
}

fn extract_mcp_entry(
    entry: &serde_yaml::Value,
    overrides_disabled: &HashMap<String, bool>,
    servers: &mut Map<String, Value>,
) {
    if entry.get("name").and_then(serde_yaml::Value::as_str) != Some("@deepseek-ai/dsh-mcp-client")
    {
        return;
    }

    let id = entry
        .get("id")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or("");

    let Some(config_val) = entry.get("config") else {
        return;
    };
    let Some(config_map) = config_val.as_mapping() else {
        return;
    };

    let server_name = config_val
        .get("serverName")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_else(|| id.strip_prefix("mcp-").unwrap_or(id));

    if server_name.is_empty() {
        return;
    }

    let entry_disabled = entry
        .get("disabled")
        .and_then(serde_yaml::Value::as_bool)
        .unwrap_or(false);

    let disabled = overrides_disabled
        .get(id)
        .copied()
        .unwrap_or(entry_disabled);

    let mut server_json = Map::new();
    server_json.insert("enabled".into(), Value::Bool(!disabled));
    server_json.insert("serverName".into(), Value::String(server_name.to_string()));

    for (k, v) in config_map {
        if let Some(k_str) = k.as_str() {
            if k_str == "transport" {
                if let Some(t_str) = v.as_str() {
                    let normalized = if t_str == "streamable-http" {
                        "http"
                    } else {
                        t_str
                    };
                    server_json.insert("transport".into(), json!(normalized));
                    continue;
                }
            }
            if let Ok(json_v) = serde_json::to_value(v) {
                server_json.insert(k_str.to_string(), json_v);
            }
        }
    }

    servers.insert(server_name.to_string(), Value::Object(server_json));
}

pub fn raw_servers(path: &Path) -> anyhow::Result<Map<String, Value>> {
    let patches = read_patch_list(path)?;
    let mut servers = Map::new();

    let mut overrides_disabled: HashMap<String, bool> = HashMap::new();
    for patch in &patches {
        if let Some(id) = patch.get("id").and_then(serde_yaml::Value::as_str) {
            if let Some(d) = patch.get("disabled").and_then(serde_yaml::Value::as_bool) {
                overrides_disabled.insert(id.to_string(), d);
            }
        }
    }

    for patch in &patches {
        if let Some(insert_seq) = patch.get("insert").and_then(serde_yaml::Value::as_sequence) {
            for entry in insert_seq {
                extract_mcp_entry(entry, &overrides_disabled, &mut servers);
            }
        } else {
            extract_mcp_entry(patch, &overrides_disabled, &mut servers);
        }
    }

    Ok(servers)
}

pub fn put_server(path: &Path, key: &str, server: &Value) -> anyhow::Result<()> {
    let mut patches = read_patch_list(path)?;
    let expected_id = format!("mcp-{key}");

    let mut config_map = serde_yaml::Mapping::new();
    config_map.insert("serverName".into(), key.into());

    let enabled = server
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    if let Some(url) = server.get("url").and_then(Value::as_str) {
        config_map.insert("transport".into(), "streamable-http".into());
        config_map.insert("url".into(), url.into());
        if let Some(headers) = server.get("headers") {
            if let Ok(y_val) = serde_yaml::to_value(headers) {
                config_map.insert("headers".into(), y_val);
            }
        }
    } else if let Some(cmd) = server.get("command").and_then(Value::as_str) {
        config_map.insert("transport".into(), "stdio".into());
        config_map.insert("command".into(), cmd.into());
        if let Some(args) = server.get("args") {
            if let Ok(y_val) = serde_yaml::to_value(args) {
                config_map.insert("args".into(), y_val);
            }
        }
        if let Some(env) = server.get("env") {
            if let Ok(y_val) = serde_yaml::to_value(env) {
                config_map.insert("env".into(), y_val);
            }
        }
        if let Some(cwd) = server.get("cwd").and_then(Value::as_str) {
            if !cwd.is_empty() {
                config_map.insert("cwd".into(), cwd.into());
            }
        }
    }

    let mut new_entry = serde_yaml::Mapping::new();
    new_entry.insert("id".into(), expected_id.clone().into());
    new_entry.insert("name".into(), "@deepseek-ai/dsh-mcp-client".into());
    if !enabled {
        new_entry.insert("disabled".into(), true.into());
    }
    new_entry.insert("config".into(), config_map.into());

    let mut updated = false;
    for patch in &mut patches {
        if let Some(seq) = patch
            .get_mut("insert")
            .and_then(serde_yaml::Value::as_sequence_mut)
        {
            for item in seq {
                if is_matching_entry(item, &expected_id, key) {
                    *item = serde_yaml::Value::Mapping(new_entry.clone());
                    updated = true;
                    break;
                }
            }
        } else if is_matching_entry(patch, &expected_id, key) {
            *patch = serde_yaml::Value::Mapping(new_entry.clone());
            updated = true;
        }
        if updated {
            break;
        }
    }

    if !updated {
        let mut inserted = false;
        for patch in &mut patches {
            if patch.get("id").is_none() {
                if let Some(seq) = patch
                    .get_mut("insert")
                    .and_then(serde_yaml::Value::as_sequence_mut)
                {
                    seq.push(serde_yaml::Value::Mapping(new_entry.clone()));
                    inserted = true;
                    break;
                }
            }
        }
        if !inserted {
            let mut insert_patch = serde_yaml::Mapping::new();
            insert_patch.insert(
                "insert".into(),
                serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(new_entry)]),
            );
            patches.push(serde_yaml::Value::Mapping(insert_patch));
        }
    }

    // Remove any standalone override disable/config patch for this id
    patches.retain(|p| {
        if p.get("id").and_then(serde_yaml::Value::as_str) == Some(&expected_id)
            && p.get("name").is_none()
        {
            return false;
        }
        true
    });

    write_patch_list(path, &patches)
}

pub fn delete_server(path: &Path, key: &str) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut patches = read_patch_list(path)?;
    let expected_id = format!("mcp-{key}");

    for patch in &mut patches {
        if let Some(seq) = patch
            .get_mut("insert")
            .and_then(serde_yaml::Value::as_sequence_mut)
        {
            seq.retain(|item| !is_matching_entry(item, &expected_id, key));
        }
    }

    patches.retain(|p| {
        if is_matching_entry(p, &expected_id, key) {
            return false;
        }
        if p.get("id").and_then(serde_yaml::Value::as_str) == Some(&expected_id) {
            return false;
        }
        if let Some(insert_val) = p.get("insert") {
            if insert_val.as_sequence().is_some_and(|s| s.is_empty()) {
                return false;
            }
        }
        true
    });

    write_patch_list(path, &patches)
}

pub fn set_server_enabled(path: &Path, name: &str, enabled: bool) -> anyhow::Result<()> {
    let raw = raw_servers(path)?;
    let key = super::resolve_key(&raw, name);
    let mut server = raw
        .get(&key)
        .cloned()
        .with_context(|| format!("MCP server not found: {name}"))?;
    server["enabled"] = json!(enabled);
    put_server(path, &key, &server)
}
