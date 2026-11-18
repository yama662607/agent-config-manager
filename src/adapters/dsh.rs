use super::{infer_package, sanitize_server_key, validate_recipe, ServerInfo};
use crate::storage::{canonical_destination, FileLock};
use crate::types::{McpRecipe, TransportType};
use anyhow::{bail, Context};
use serde_yaml::{Mapping, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const DSH_MCP_PLUGIN_NAME: &str = "@deepseek-ai/dsh-mcp-client";

fn operation_lock(path: &Path) -> PathBuf {
    PathBuf::from(format!(
        "{}.acm-operation.lock",
        canonical_destination(path).display()
    ))
}

fn read_yaml_sequence(path: &Path) -> anyhow::Result<Vec<Value>> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            if raw.trim().is_empty() {
                return Ok(Vec::new());
            }
            let val: Value = serde_yaml::from_str(&raw)
                .with_context(|| format!("Invalid YAML in {}", path.display()))?;
            match val {
                Value::Null => Ok(Vec::new()),
                Value::Sequence(seq) => Ok(seq),
                _ => bail!("Expected top-level YAML sequence in {}", path.display()),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn write_raw(path: &Path, rendered: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    use std::io::Write;
    tmp.write_all(rendered.as_bytes())?;
    tmp.flush()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

fn write_yaml_sequence(path: &Path, seq: &[Value]) -> anyhow::Result<()> {
    let rendered = serde_yaml::to_string(&Value::Sequence(seq.to_vec()))?;
    write_raw(path, &rendered)
}

fn split_top_level_yaml_items(raw: &str) -> Option<(String, Vec<String>)> {
    if raw.trim().is_empty() {
        return Some((String::new(), Vec::new()));
    }
    let mut header = String::new();
    let mut items: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_items = false;

    for line in raw.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
        if trimmed.starts_with("- ") || trimmed == "-" {
            if in_items {
                items.push(std::mem::take(&mut current));
            }
            in_items = true;
            current.push_str(line);
        } else if in_items {
            current.push_str(line);
        } else {
            header.push_str(line);
        }
    }
    if in_items {
        items.push(current);
    } else if !header.trim().is_empty()
        && header.lines().all(|l| {
            let t = l.trim();
            t.is_empty() || t.starts_with('#') || t == "[]"
        })
    {
        if header.trim() == "[]" || header.lines().any(|l| l.trim() == "[]") {
            let cleaned: String = header
                .lines()
                .filter(|l| l.trim() != "[]")
                .map(|l| format!("{l}\n"))
                .collect();
            return Some((cleaned, Vec::new()));
        }
        return Some((header, Vec::new()));
    } else if !header.trim().is_empty() {
        return None;
    }

    for chunk in &items {
        let parsed: Value = serde_yaml::from_str(chunk).ok()?;
        if parsed.as_sequence().is_none_or(|s| s.len() != 1) {
            return None;
        }
    }
    Some((header, items))
}

fn chunk_has_target_mcp(chunk: &str, key: &str) -> bool {
    let Ok(Value::Sequence(seq)) = serde_yaml::from_str::<Value>(chunk) else {
        return false;
    };
    let mut entries = Vec::new();
    collect_entries(&seq, &mut entries);
    entries
        .into_iter()
        .any(|m| entry_server_name(m).as_deref() == Some(key))
}

fn render_preserved_chunks(header: &str, items: &[String]) -> String {
    let mut out = String::new();
    if !header.is_empty() {
        out.push_str(header);
        if !header.ends_with('\n') {
            out.push('\n');
        }
    }
    if items.is_empty() {
        out.push_str("[]\n");
        return out;
    }
    for item in items {
        out.push_str(item);
        if !item.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

fn is_dsh_mcp_entry(map: &Mapping) -> bool {
    map.get(Value::String("name".into()))
        .and_then(Value::as_str)
        == Some(DSH_MCP_PLUGIN_NAME)
}

fn entry_server_name(map: &Mapping) -> Option<String> {
    if let Some(name) = map
        .get(Value::String("config".into()))
        .and_then(Value::as_mapping)
        .and_then(|cfg| cfg.get(Value::String("serverName".into())))
        .and_then(Value::as_str)
    {
        return Some(name.to_string());
    }
    map.get(Value::String("id".into()))
        .and_then(Value::as_str)
        .map(|id| id.strip_prefix("mcp-").unwrap_or(id).to_string())
}

fn recipe_from_dsh_entry(map: &Mapping) -> anyhow::Result<McpRecipe> {
    let cfg = map
        .get(Value::String("config".into()))
        .and_then(Value::as_mapping)
        .context("dsh MCP entry missing config mapping")?;

    let transport_str = cfg
        .get(Value::String("transport".into()))
        .and_then(Value::as_str)
        .unwrap_or("stdio");

    let url = cfg
        .get(Value::String("url".into()))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let command = cfg
        .get(Value::String("command".into()))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let args = cfg
        .get(Value::String("args".into()))
        .and_then(Value::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        });

    let cwd = cfg
        .get(Value::String("cwd".into()))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let env = cfg
        .get(Value::String("env".into()))
        .and_then(Value::as_mapping)
        .map(|m| {
            let mut out = HashMap::new();
            for (k, v) in m {
                if let (Some(ks), Some(vs)) = (k.as_str(), v.as_str()) {
                    out.insert(ks.to_string(), vs.to_string());
                }
            }
            out
        });

    let transport = Some(if url.is_some() || transport_str == "streamable-http" {
        if transport_str == "sse" {
            TransportType::Sse
        } else {
            TransportType::Http
        }
    } else {
        TransportType::Stdio
    });

    Ok(McpRecipe {
        command,
        args,
        url,
        cwd,
        env,
        transport,
    })
}

fn collect_entries<'a>(seq: &'a [Value], out: &mut Vec<&'a Mapping>) {
    for item in seq {
        let Some(map) = item.as_mapping() else {
            continue;
        };
        if let Some(Value::Sequence(inserted)) = map.get(Value::String("insert".into())) {
            for child in inserted {
                if let Some(child_map) = child.as_mapping() {
                    if is_dsh_mcp_entry(child_map) {
                        out.push(child_map);
                    }
                }
            }
        } else if is_dsh_mcp_entry(map) {
            out.push(map);
        }
    }
}

pub fn get_mcp_servers(path: &Path) -> anyhow::Result<HashMap<String, ServerInfo>> {
    let seq = read_yaml_sequence(path)?;
    let mut entries = Vec::new();
    collect_entries(&seq, &mut entries);

    let mut result = HashMap::new();
    for map in entries {
        let Some(name) = entry_server_name(map) else {
            continue;
        };
        let disabled = map
            .get(Value::String("disabled".into()))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let recipe = recipe_from_dsh_entry(map)?;
        result.insert(
            name,
            ServerInfo {
                enabled: !disabled,
                recipe: Some(recipe),
            },
        );
    }
    Ok(result)
}

fn resolve_dsh_key(existing: &HashMap<String, ServerInfo>, name: &str) -> String {
    if existing.contains_key(name) {
        return name.to_string();
    }
    for (key, info) in existing {
        if info
            .recipe
            .as_ref()
            .and_then(infer_package)
            .is_some_and(|pkg| pkg == name)
        {
            return key.clone();
        }
    }
    sanitize_server_key(name)
}

fn apply_recipe_to_config(cfg: &mut Mapping, server_name: &str, recipe: &McpRecipe) {
    cfg.insert(
        Value::String("serverName".into()),
        Value::String(server_name.to_string()),
    );
    for k in ["transport", "command", "args", "cwd", "env", "url"] {
        cfg.remove(Value::String(k.into()));
    }
    if let Some(url) = &recipe.url {
        cfg.insert(
            Value::String("transport".into()),
            Value::String(if matches!(recipe.transport, Some(TransportType::Sse)) {
                "sse".into()
            } else {
                "streamable-http".into()
            }),
        );
        cfg.insert(Value::String("url".into()), Value::String(url.clone()));
    } else {
        cfg.insert(
            Value::String("transport".into()),
            Value::String("stdio".into()),
        );
        if let Some(command) = &recipe.command {
            cfg.insert(
                Value::String("command".into()),
                Value::String(command.clone()),
            );
        }
        if let Some(args) = &recipe.args {
            cfg.insert(
                Value::String("args".into()),
                Value::Sequence(args.iter().cloned().map(Value::String).collect()),
            );
        }
        if let Some(cwd) = &recipe.cwd {
            cfg.insert(Value::String("cwd".into()), Value::String(cwd.clone()));
        }
        if let Some(env) = &recipe.env {
            let mut env_map = Mapping::new();
            let mut keys: Vec<&String> = env.keys().collect();
            keys.sort();
            for k in keys {
                env_map.insert(Value::String(k.clone()), Value::String(env[k].clone()));
            }
            cfg.insert(Value::String("env".into()), Value::Mapping(env_map));
        }
    }
}

fn find_mut_entry<'a>(seq: &'a mut [Value], key: &str) -> Option<&'a mut Mapping> {
    for item in seq.iter_mut() {
        let Some(map) = item.as_mapping_mut() else {
            continue;
        };
        let has_insert = map.contains_key(Value::String("insert".into()));
        if has_insert {
            if let Some(Value::Sequence(inserted)) = map.get_mut(Value::String("insert".into())) {
                for child in inserted.iter_mut() {
                    if let Some(child_map) = child.as_mapping_mut() {
                        if is_dsh_mcp_entry(child_map)
                            && entry_server_name(child_map).as_deref() == Some(key)
                        {
                            return Some(child_map);
                        }
                    }
                }
            }
        } else if is_dsh_mcp_entry(map) && entry_server_name(map).as_deref() == Some(key) {
            return Some(map);
        }
    }
    None
}

pub fn preview_mcp_add(
    path: &Path,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    validate_recipe(recipe)?;
    let existing = get_mcp_servers(path)?;
    let key = resolve_dsh_key(&existing, server_name);
    if key != server_name {
        if let Some(prior) = existing.get(&key).and_then(|s| s.recipe.as_ref()) {
            if infer_package(prior).is_some_and(|pkg| pkg != server_name) {
                bail!("Server name collision: {server_name} would replace {key}");
            }
        }
    }
    Ok(key)
}

fn mutate_yaml_preserving_other_items<F>(
    path: &Path,
    key: &str,
    mut mutate: F,
) -> anyhow::Result<bool>
where
    F: FnMut(&mut Vec<Value>) -> anyhow::Result<bool>,
{
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };

    if let Some((header, mut chunks)) = split_top_level_yaml_items(&raw) {
        let mut matched_idx = None;
        for (idx, chunk) in chunks.iter().enumerate() {
            if chunk_has_target_mcp(chunk, key) {
                matched_idx = Some(idx);
                break;
            }
        }
        if let Some(idx) = matched_idx {
            let mut sub_seq: Vec<Value> = serde_yaml::from_str(&chunks[idx])?;
            let changed = mutate(&mut sub_seq)?;
            if !changed {
                return Ok(false);
            }
            if sub_seq.is_empty() {
                chunks.remove(idx);
            } else {
                chunks[idx] = serde_yaml::to_string(&Value::Sequence(sub_seq))?;
            }
            write_raw(path, &render_preserved_chunks(&header, &chunks))?;
            return Ok(true);
        }

        let mut appended = Vec::new();
        let changed = mutate(&mut appended)?;
        if !changed {
            return Ok(false);
        }
        if !appended.is_empty() {
            chunks.push(serde_yaml::to_string(&Value::Sequence(appended))?);
        }
        write_raw(path, &render_preserved_chunks(&header, &chunks))?;
        return Ok(true);
    }

    let mut seq = read_yaml_sequence(path)?;
    let changed = mutate(&mut seq)?;
    if changed {
        write_yaml_sequence(path, &seq)?;
    }
    Ok(changed)
}

pub fn add_mcp_to_config(
    path: &Path,
    server_name: &str,
    recipe: &McpRecipe,
) -> anyhow::Result<String> {
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let key = preview_mcp_add(path, server_name, recipe)?;

    mutate_yaml_preserving_other_items(path, &key, |seq| {
        if let Some(entry) = find_mut_entry(seq, &key) {
            let cfg_val = entry
                .entry(Value::String("config".into()))
                .or_insert_with(|| Value::Mapping(Mapping::new()));
            if !cfg_val.is_mapping() {
                *cfg_val = Value::Mapping(Mapping::new());
            }
            let cfg = cfg_val.as_mapping_mut().unwrap();
            apply_recipe_to_config(cfg, &key, recipe);
            entry.remove(Value::String("disabled".into()));
        } else {
            let mut cfg = Mapping::new();
            apply_recipe_to_config(&mut cfg, &key, recipe);

            let mut entry = Mapping::new();
            entry.insert(
                Value::String("id".into()),
                Value::String(format!("mcp-{key}")),
            );
            entry.insert(
                Value::String("name".into()),
                Value::String(DSH_MCP_PLUGIN_NAME.into()),
            );
            entry.insert(Value::String("config".into()), Value::Mapping(cfg));

            let mut wrapper = Mapping::new();
            wrapper.insert(
                Value::String("insert".into()),
                Value::Sequence(vec![Value::Mapping(entry)]),
            );
            seq.push(Value::Mapping(wrapper));
        }
        Ok(true)
    })?;

    Ok(key)
}

pub fn remove_mcp_from_config(path: &Path, name: &str) -> anyhow::Result<()> {
    let _operation = FileLock::acquire(&operation_lock(path))?;
    if !path.exists() {
        return Ok(());
    }
    let existing = get_mcp_servers(path)?;
    let key = resolve_dsh_key(&existing, name);

    mutate_yaml_preserving_other_items(path, &key, |seq| {
        let mut changed = false;
        seq.retain_mut(|item| {
            let Some(map) = item.as_mapping_mut() else {
                return true;
            };
            if let Some(Value::Sequence(inserted)) = map.get_mut(Value::String("insert".into())) {
                let before = inserted.len();
                inserted.retain(|child| {
                    !child.as_mapping().is_some_and(|m| {
                        is_dsh_mcp_entry(m) && entry_server_name(m).as_deref() == Some(key.as_str())
                    })
                });
                if inserted.len() != before {
                    changed = true;
                }
                return !inserted.is_empty();
            }
            if is_dsh_mcp_entry(map) && entry_server_name(map).as_deref() == Some(key.as_str()) {
                changed = true;
                return false;
            }
            true
        });
        Ok(changed)
    })?;

    Ok(())
}

pub fn set_mcp_enabled(path: &Path, name: &str, enabled: bool) -> anyhow::Result<()> {
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let existing = get_mcp_servers(path)?;
    let key = resolve_dsh_key(&existing, name);
    mutate_yaml_preserving_other_items(path, &key, |seq| {
        let entry = find_mut_entry(seq, &key)
            .with_context(|| format!("MCP server not configured: {name}"))?;
        if enabled {
            entry.remove(Value::String("disabled".into()));
        } else {
            entry.insert(Value::String("disabled".into()), Value::Bool(true));
        }
        Ok(true)
    })?;
    Ok(())
}

pub fn replace_mcp_recipe(
    path: &Path,
    key: &str,
    expected: &ServerInfo,
    recipe: &McpRecipe,
) -> anyhow::Result<()> {
    validate_recipe(recipe)?;
    let _operation = FileLock::acquire(&operation_lock(path))?;
    let current = get_mcp_servers(path)?;
    if current.get(key) != Some(expected) {
        bail!("MCP conflict: {key} changed since it was inspected; refresh before editing");
    }
    mutate_yaml_preserving_other_items(path, key, |seq| {
        let entry = find_mut_entry(seq, key).context("MCP definition disappeared")?;
        let cfg_val = entry
            .entry(Value::String("config".into()))
            .or_insert_with(|| Value::Mapping(Mapping::new()));
        if !cfg_val.is_mapping() {
            *cfg_val = Value::Mapping(Mapping::new());
        }
        apply_recipe_to_config(cfg_val.as_mapping_mut().unwrap(), key, recipe);
        if expected.enabled {
            entry.remove(Value::String("disabled".into()));
        } else {
            entry.insert(Value::String("disabled".into()), Value::Bool(true));
        }
        Ok(true)
    })?;
    Ok(())
}
