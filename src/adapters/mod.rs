pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod dsh;
pub mod grok;

use crate::paths::{get_agent_mcp_config_path, get_state_dir, home_dir};
use crate::storage::{object_at, read_value, update_value, write_value, FileLock};
use crate::types::{McpRecipe, ProviderKind, TargetName, TransportType};
use anyhow::{bail, Context};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfo {
    pub enabled: bool,
    pub recipe: Option<McpRecipe>,
}

pub fn server_block(target: TargetName) -> &'static str {
    match target.provider_kind() {
        ProviderKind::Claude | ProviderKind::Antigravity => "mcpServers",
        _ => "mcp_servers",
    }
}

pub fn sanitize_server_key(name: &str) -> String {
    if !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return name.to_owned();
    }
    let base = name
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .trim_start_matches("server-")
        .trim_end_matches("-mcp");
    let clean: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let clean = clean.trim_matches('_');
    if clean.is_empty() {
        "server".to_owned()
    } else {
        clean.to_owned()
    }
}

pub fn infer_package(recipe: &McpRecipe) -> Option<&str> {
    if !["npx", "npm", "pnpm", "yarn", "bunx"].contains(&recipe.command.as_deref()?) {
        return None;
    }
    recipe
        .args
        .as_ref()?
        .iter()
        .find(|a| !a.starts_with('-') && !["exec", "dlx", "run"].contains(&a.as_str()))
        .map(String::as_str)
}

pub fn recipe_from_native(value: &Value) -> anyhow::Result<McpRecipe> {
    if !value.is_object() {
        bail!("MCP server definition must be an object");
    }
    let mut raw = value.clone();
    if let Some(url) = value
        .get("url")
        .or_else(|| value.get("serverUrl"))
        .or_else(|| value.get("httpUrl"))
    {
        raw["url"] = url.clone();
    }
    let mut recipe: McpRecipe =
        serde_json::from_value(raw).context("Invalid MCP server definition")?;
    recipe.transport = Some(if recipe.url.is_some() {
        if value.get("type").and_then(Value::as_str) == Some("sse") {
            TransportType::Sse
        } else {
            TransportType::Http
        }
    } else {
        TransportType::Stdio
    });
    Ok(recipe)
}

pub fn validate_recipe(recipe: &McpRecipe) -> anyhow::Result<()> {
    let command = recipe.command.as_deref().filter(|s| !s.trim().is_empty());
    let url = recipe.url.as_deref().filter(|s| !s.trim().is_empty());
    if command.is_some() == url.is_some() {
        bail!("Specify exactly one MCP command or URL");
    }
    if matches!(recipe.transport, Some(TransportType::Stdio)) && url.is_some()
        || matches!(
            recipe.transport,
            Some(TransportType::Http | TransportType::Sse)
        ) && command.is_some()
    {
        bail!("MCP transport conflicts with the selected command or URL");
    }
    if let Some(url) = url {
        if !url.starts_with("https://") && !url.starts_with("http://") {
            bail!("MCP URL must use http or https");
        }
    }
    if command.is_some_and(|s| s.chars().any(char::is_control)) {
        bail!("MCP command contains control characters");
    }
    if let Some(env) = &recipe.env {
        for (key, value) in env {
            if key.is_empty()
                || !key
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                bail!("Invalid environment variable name: {key}");
            }
            if value.contains('\0') || value.len() > 5000 {
                bail!("Invalid environment value for {key}");
            }
        }
    }
    Ok(())
}

pub fn native_definition(
    target: TargetName,
    recipe: &McpRecipe,
    previous: Option<&Value>,
) -> anyhow::Result<Value> {
    validate_recipe(recipe)?;
    let mut server = previous.cloned().unwrap_or_else(|| json!({}));
    let object = server
        .as_object_mut()
        .context("Invalid existing MCP definition")?;
    for key in [
        "command",
        "args",
        "url",
        "httpUrl",
        "serverUrl",
        "cwd",
        "env",
        "type",
        "transport",
    ] {
        object.remove(key);
    }
    let mut fields = serde_json::to_value(recipe)?.as_object().unwrap().clone();
    fields.remove("transport");
    if target.provider_kind() == ProviderKind::Antigravity {
        if let Some(url) = fields.remove("url") {
            fields.insert("serverUrl".into(), url);
        }
    }
    if target.provider_kind() == ProviderKind::Claude {
        fields.insert(
            "type".into(),
            json!(match recipe.transport {
                Some(TransportType::Sse) => "sse",
                _ if recipe.url.is_some() => "http",
                _ => "stdio",
            }),
        );
    }
    object.extend(fields);
    if matches!(
        target.provider_kind(),
        ProviderKind::Codex | ProviderKind::Grok
    ) {
        object.insert("enabled".into(), json!(true));
    }
    Ok(server)
}

fn disabled_path(path: &Path) -> PathBuf {
    let key = crate::storage::canonical_destination(path);
    let hash = format!("{:x}", Sha256::digest(key.to_string_lossy().as_bytes()));
    get_state_dir()
        .join("disabled-mcps")
        .join(format!("{hash}.json"))
}

fn operation_lock(path: &Path) -> PathBuf {
    PathBuf::from(format!(
        "{}.acm-operation.lock",
        crate::storage::canonical_destination(path).display()
    ))
}

fn servers(value: &Value, target: &TargetName) -> anyhow::Result<Map<String, Value>> {
    match value.get(server_block(target.clone())) {
        Some(value) => value
            .as_object()
            .cloned()
            .context("MCP server block must be an object"),
        None => Ok(Map::new()),
    }
}

pub fn raw_servers(target: TargetName, path: &Path) -> anyhow::Result<Map<String, Value>> {
    servers(&read_value(path)?, &target)
}

pub fn resolve_key(servers: &Map<String, Value>, name: &str) -> String {
    if servers.contains_key(name) {
        return name.to_owned();
    }
    for (key, value) in servers {
        if recipe_from_native(value)
            .ok()
            .and_then(|r| infer_package(&r).map(str::to_owned))
            .as_deref()
            == Some(name)
        {
            return key.clone();
        }
    }
    sanitize_server_key(name)
}

pub fn get_mcp_servers<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
) -> anyhow::Result<HashMap<String, ServerInfo>> {
    let path = config_path.as_ref();
    let provider = target.provider_kind();
    if provider == ProviderKind::Dsh {
        return dsh::get_mcp_servers(path);
    }
    let configured = raw_servers(target.clone(), path)?;
    let mut result = HashMap::new();
    for (name, server) in &configured {
        result.insert(
            name.clone(),
            ServerInfo {
                enabled: server
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                recipe: Some(recipe_from_native(server)?),
            },
        );
    }
    if matches!(provider, ProviderKind::Claude | ProviderKind::Antigravity) {
        for (name, value) in read_value(&disabled_path(path))?.as_object().unwrap() {
            if !configured.contains_key(name) {
                result.insert(
                    name.clone(),
                    ServerInfo {
                        enabled: false,
                        recipe: Some(recipe_from_native(value)?),
                    },
                );
            }
        }
    }
    Ok(result)
}

fn is_claude_user(target: &TargetName, path: &Path) -> bool {
    if target.provider_kind() != ProviderKind::Claude {
        return false;
    }
    let user_path = get_agent_mcp_config_path(home_dir(), target);
    path == user_path
        || path
            .canonicalize()
            .ok()
            .zip(user_path.canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}

fn claude_command(target: &TargetName, args: &[String]) -> anyhow::Result<()> {
    crate::core::plugin::provider_command(target.clone(), &home_dir(), args)
        .map(|_| ())
        .map_err(|error| {
            anyhow::anyhow!(
                "claude mcp failed: {}",
                crate::core::operations::redact_command_output(&format!("{error:#}"), args)
            )
        })
}

fn put_server(target: &TargetName, path: &Path, key: &str, server: &Value) -> anyhow::Result<()> {
    if is_claude_user(target, path) {
        let previous = raw_servers(target.clone(), path)?.get(key).cloned();
        if previous.as_ref() == Some(server) {
            return Ok(());
        }
        if previous.is_some() {
            claude_command(
                target,
                &[
                    "mcp".into(),
                    "remove".into(),
                    key.into(),
                    "-s".into(),
                    "user".into(),
                ],
            )?;
        }
        if let Err(error) = claude_command(
            target,
            &[
                "mcp".into(),
                "add-json".into(),
                key.into(),
                serde_json::to_string(server)?,
                "-s".into(),
                "user".into(),
            ],
        ) {
            if let Some(previous) = previous {
                if let Err(rollback) = claude_command(
                    target,
                    &[
                        "mcp".into(),
                        "add-json".into(),
                        key.into(),
                        serde_json::to_string(&previous)?,
                        "-s".into(),
                        "user".into(),
                    ],
                ) {
                    return Err(error.context(format!(
                        "Restoring the previous server also failed: {rollback}"
                    )));
                }
            }
            return Err(error);
        }
        let actual = raw_servers(target.clone(), path)?;
        if !actual.get(key).is_some_and(|actual| {
            server
                .as_object()
                .unwrap()
                .iter()
                .all(|(k, v)| actual.get(k) == Some(v))
        }) {
            bail!("Claude reported success but the requested server was not persisted: {key}");
        }
    } else {
        update_value(path, |value| {
            object_at(value, server_block(target.clone()))?.insert(key.into(), server.clone());
            Ok(())
        })?;
    }
    Ok(())
}

fn delete_server(target: &TargetName, path: &Path, key: &str) -> anyhow::Result<()> {
    if is_claude_user(target, path) {
        if raw_servers(target.clone(), path)?.contains_key(key) {
            claude_command(
                target,
                &[
                    "mcp".into(),
                    "remove".into(),
                    key.into(),
                    "-s".into(),
                    "user".into(),
                ],
            )?;
            if raw_servers(target.clone(), path)?.contains_key(key) {
                bail!("Claude did not remove {key}");
            }
        }
    } else if path.exists() {
        update_value(path, |value| {
            object_at(value, server_block(target.clone()))?.remove(key);
            Ok(())
        })?;
    }
    Ok(())
}

/// Read-only validation shared by previews and locked writes.
pub fn preview_mcp_add(
    target: TargetName,
    path: &Path,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    if target.provider_kind() == ProviderKind::Dsh {
        return dsh::preview_mcp_add(path, server_name, recipe);
    }
    validate_recipe(recipe)?;
    let configured = raw_servers(target.clone(), path)?;
    let key = resolve_key(&configured, server_name);
    if key != server_name && configured.contains_key(&key) {
        let prior = recipe_from_native(&configured[&key])?;
        if infer_package(&prior).is_some_and(|package| package != server_name) {
            bail!("Server name collision: {server_name} would replace {key}");
        }
    }
    let saved = read_value(&disabled_path(path))?;
    if !saved.is_object() {
        bail!("Invalid saved MCP definitions");
    }
    native_definition(
        target,
        recipe,
        configured.get(&key).or_else(|| saved.get(&key)),
    )?;
    Ok(key)
}

pub fn add_mcp_to_config<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    let path = config_path.as_ref();
    if target.provider_kind() == ProviderKind::Dsh {
        return dsh::add_mcp_to_config(path, server_name, recipe);
    }
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let key = preview_mcp_add(target.clone(), path, server_name, recipe)?;
    let configured = raw_servers(target.clone(), path)?;
    let saved_path = disabled_path(path);
    let saved = read_value(&saved_path)?;
    put_server(
        &target,
        path,
        &key,
        &native_definition(
            target.clone(),
            recipe,
            configured.get(&key).or_else(|| saved.get(&key)),
        )?,
    )?;
    if saved_path.exists() {
        let mut saved = read_value(&saved_path)?;
        saved.as_object_mut().unwrap().remove(&key);
        write_value(&saved_path, &saved)?;
    }
    Ok(key)
}

pub fn edit_mcp_in_config(
    target: TargetName,
    path: &Path,
    name: &str,
    patch: &McpRecipe,
) -> anyhow::Result<()> {
    let mut recipe = if target.provider_kind() == ProviderKind::Dsh {
        let existing = dsh::get_mcp_servers(path)?;
        let prior = existing
            .get(name)
            .and_then(|s| s.recipe.clone())
            .with_context(|| format!("MCP server not configured: {name}"))?;
        serde_json::to_value(prior)?
    } else {
        let configured = raw_servers(target.clone(), path)?;
        let key = resolve_key(&configured, name);
        let previous = configured
            .get(&key)
            .with_context(|| format!("MCP server not configured: {name}"))?;
        serde_json::to_value(recipe_from_native(previous)?)?
    };
    if patch.command.is_some() {
        recipe.as_object_mut().unwrap().remove("url");
    }
    if patch.url.is_some() {
        for field in ["command", "args"] {
            recipe.as_object_mut().unwrap().remove(field);
        }
    }
    recipe
        .as_object_mut()
        .unwrap()
        .extend(serde_json::to_value(patch)?.as_object().unwrap().clone());
    let recipe: McpRecipe = serde_json::from_value(recipe)?;
    add_mcp_to_config(target, path, name, &recipe)?;
    Ok(())
}

/// Replace an observed recipe without changing its enabled state or losing concurrent edits.
pub fn replace_mcp_recipe(
    target: TargetName,
    path: &Path,
    key: &str,
    expected: &ServerInfo,
    recipe: &McpRecipe,
) -> anyhow::Result<()> {
    if target.provider_kind() == ProviderKind::Dsh {
        return dsh::replace_mcp_recipe(path, key, expected, recipe);
    }
    validate_recipe(recipe)?;
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let current = get_mcp_servers(target.clone(), path)?;
    if current.get(key) != Some(expected) {
        bail!("MCP conflict: {key} changed since it was inspected; refresh before editing");
    }
    let configured = raw_servers(target.clone(), path)?;
    let saved_path = disabled_path(path);
    if !expected.enabled
        && matches!(
            target.provider_kind(),
            ProviderKind::Claude | ProviderKind::Antigravity
        )
        && !configured.contains_key(key)
    {
        let mut saved = read_value(&saved_path)?;
        let previous = saved
            .get(key)
            .context("Saved disabled MCP definition disappeared")?;
        saved[key] = native_definition(target, recipe, Some(previous))?;
        return write_value(&saved_path, &saved);
    }
    let previous = configured.get(key).context("MCP definition disappeared")?;
    let mut value = native_definition(target.clone(), recipe, Some(previous))?;
    if !expected.enabled {
        value["enabled"] = json!(false);
    }
    put_server(&target, path, key, &value)
}

pub fn remove_mcp_from_config<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    name: &str,
) -> anyhow::Result<()> {
    let path = config_path.as_ref();
    if target.provider_kind() == ProviderKind::Dsh {
        return dsh::remove_mcp_from_config(path, name);
    }
    let saved_path = disabled_path(path);
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let mut saved = read_value(&saved_path)?;
    let configured = raw_servers(target.clone(), path)?;
    let key = resolve_key(&configured, name);
    delete_server(&target, path, &key)?;
    if saved.as_object_mut().unwrap().remove(&key).is_some() {
        write_value(&saved_path, &saved)?;
    }
    Ok(())
}

pub fn set_mcp_enabled<P: AsRef<Path>>(
    target: TargetName,
    config_path: P,
    name: &str,
    enabled: bool,
) -> anyhow::Result<()> {
    let path = config_path.as_ref();
    let provider = target.provider_kind();
    if provider == ProviderKind::Dsh {
        return dsh::set_mcp_enabled(path, name, enabled);
    }
    if matches!(provider, ProviderKind::Codex | ProviderKind::Grok) {
        let _operation = FileLock::acquire(&operation_lock(path))?;
        return update_value(path, |value| {
            let servers = object_at(value, server_block(target.clone()))?;
            let key = resolve_key(servers, name);
            let server = servers
                .get_mut(&key)
                .with_context(|| format!("MCP server not configured: {name}"))?;
            server["enabled"] = json!(enabled);
            Ok(())
        });
    }
    let saved_path = disabled_path(path);
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let configured = raw_servers(target.clone(), path)?;
    let mut saved = read_value(&saved_path)?;
    let mut key = resolve_key(&configured, name);
    if !configured.contains_key(&key) {
        key = resolve_key(saved.as_object().unwrap(), name);
    }
    if enabled {
        if configured.contains_key(&key) {
            return Ok(());
        }
        let server = saved
            .get(&key)
            .with_context(|| {
                format!("No saved definition for {name}; add it from the catalog first")
            })?
            .clone();
        put_server(&target, path, &key, &server)?;
        saved.as_object_mut().unwrap().remove(&key);
        write_value(&saved_path, &saved)?;
    } else if let Some(server) = configured.get(&key) {
        saved[&key] = server.clone();
        write_value(&saved_path, &saved)?;
        delete_server(&target, path, &key)?;
    } else if saved.get(&key).is_none() {
        bail!("MCP server not configured: {name}");
    }
    Ok(())
}
