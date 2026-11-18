pub use super::sanitize_server_key;
use crate::storage::{object_at, read_value, update_value};
use crate::types::{McpRecipe, TargetName};
use anyhow::Context;
use serde_json::{json, Value};
use std::path::Path;

pub fn get_mcp_servers<P: AsRef<Path>>(
    path: P,
) -> anyhow::Result<std::collections::HashMap<String, super::ServerInfo>> {
    super::get_mcp_servers(TargetName::Grok, path)
}
pub fn add_mcp_to_config<P: AsRef<Path>>(
    path: P,
    name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    super::add_mcp_to_config(TargetName::Grok, path, name, recipe)
}
pub fn remove_mcp_from_config<P: AsRef<Path>>(path: P, name: &str) -> anyhow::Result<()> {
    super::remove_mcp_from_config(TargetName::Grok, path, name)
}
pub fn set_mcp_enabled<P: AsRef<Path>>(path: P, name: &str, enabled: bool) -> anyhow::Result<()> {
    super::set_mcp_enabled(TargetName::Grok, path, name, enabled)
}

fn update_list(path: &Path, field: &str, item: &str, present: bool) -> anyhow::Result<bool> {
    update_value(path, |value| {
        let values = object_at(value, "skills")?
            .entry(field)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .with_context(|| format!("skills.{field} must be an array"))?;
        let found = values.iter().any(|v| v.as_str() == Some(item));
        if present && !found {
            values.push(json!(item));
        }
        if !present {
            values.retain(|v| v.as_str() != Some(item));
        }
        Ok(found != present)
    })
}

pub fn register_skill_path<P: AsRef<Path>>(path: P, dir: &str) -> anyhow::Result<bool> {
    update_list(path.as_ref(), "paths", dir, true)
}
pub fn unregister_skill_path<P: AsRef<Path>>(path: P, dir: &str) -> anyhow::Result<bool> {
    update_list(path.as_ref(), "paths", dir, false)
}
pub fn set_skill_disabled<P: AsRef<Path>>(
    path: P,
    name: &str,
    disabled: bool,
) -> anyhow::Result<()> {
    update_list(path.as_ref(), "disabled", name, disabled).map(|_| ())
}

pub fn skill_paths(path: &Path) -> anyhow::Result<Vec<String>> {
    let raw = read_value(path)?;
    match raw.get("skills").and_then(|v| v.get("paths")) {
        Some(value) => Ok(serde_json::from_value(value.clone()).context("Invalid skills.paths")?),
        None => Ok(Vec::new()),
    }
}

pub fn is_skill_path_registered<P: AsRef<Path>>(path: P, dir: &str) -> anyhow::Result<bool> {
    let wanted = crate::paths::expand_home(dir);
    Ok(skill_paths(path.as_ref())?.iter().any(|p| {
        let p = crate::paths::expand_home(p);
        p == wanted
            || p.canonicalize()
                .ok()
                .zip(wanted.canonicalize().ok())
                .is_some_and(|(a, b)| a == b)
    }))
}

pub fn is_skill_disabled(path: &Path, name: &str) -> anyhow::Result<bool> {
    let raw = read_value(path)?;
    Ok(raw
        .get("skills")
        .and_then(|v| v.get("disabled"))
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|v| v.as_str() == Some(name))))
}
