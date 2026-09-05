use crate::adapters::{
    add_mcp_to_config, get_mcp_servers, infer_package, remove_mcp_from_config, sanitize_server_key,
    set_mcp_enabled, validate_recipe,
};
use crate::catalog::store::{add_mcp, get_mcp, list_mcps};
use crate::paths::{get_agent_mcp_config_path, warn_unsupported_scope};
use crate::types::{
    McpCatalogEntry, McpRecipe, McpStatus, McpWorkspaceStatus, TargetName, TransportType,
};
use anyhow::{bail, Context};
use std::collections::HashMap;
use std::path::Path;

pub fn match_entry<'a>(
    entries: &'a [McpCatalogEntry],
    name: &str,
    recipe: &McpRecipe,
) -> Option<&'a McpCatalogEntry> {
    if let Some(entry) = entries.iter().find(|entry| entry.id == name) {
        return Some(entry);
    }
    let same: Vec<_> = entries
        .iter()
        .filter(|entry| {
            infer_package(&entry.recipe).is_some()
                && infer_package(&entry.recipe) == infer_package(recipe)
        })
        .collect();
    if let Some(entry) = same
        .iter()
        .find(|entry| recipes_match(&entry.recipe, recipe))
    {
        return Some(entry);
    }
    if let Some(entry) = same.first() {
        return Some(entry);
    }
    let candidates: Vec<_> = entries
        .iter()
        .filter(|entry| sanitize_server_key(&entry.id) == sanitize_server_key(name))
        .collect();
    if candidates.len() == 1 {
        Some(candidates[0])
    } else {
        None
    }
}

pub fn recipes_match(left: &McpRecipe, right: &McpRecipe) -> bool {
    left.command == right.command
        && left.url == right.url
        && left.cwd == right.cwd
        && left.args.clone().unwrap_or_default() == right.args.clone().unwrap_or_default()
        && left.env.clone().unwrap_or_default() == right.env.clone().unwrap_or_default()
}

pub fn get_mcp_workspace_status<P: AsRef<Path>>(
    project_root: P,
    targets: &[TargetName],
) -> anyhow::Result<McpWorkspaceStatus> {
    let root = project_root.as_ref();
    let catalog = list_mcps()?;
    let mut server_map: HashMap<String, McpStatus> = HashMap::new();
    for &target in targets {
        for (name, info) in get_mcp_servers(target, get_agent_mcp_config_path(root, target))? {
            let recipe = info.recipe.unwrap_or_default();
            let found = match_entry(&catalog, &name, &recipe);
            let state = if !info.enabled {
                "disabled"
            } else if let Some(entry) = found {
                if recipes_match(&entry.recipe, &recipe) {
                    "synced"
                } else {
                    "differs"
                }
            } else {
                "inline"
            };
            let name = found.map(|entry| entry.id.clone()).unwrap_or(name);
            let entry = server_map.entry(name.clone()).or_insert_with(|| McpStatus {
                name,
                enabled: false,
                targets: Vec::new(),
                recipe: recipe.clone(),
                source: if found.is_some() { "catalog" } else { "inline" }.into(),
                catalog: found.map(|entry| entry.recipe.clone()),
                state: HashMap::new(),
                deployed: HashMap::new(),
                plugin: None,
            });
            entry.enabled |= info.enabled;
            entry.targets.push(target);
            entry.state.insert(target, state.into());
            entry.deployed.insert(target, recipe);
        }
    }
    for plugin in crate::core::plugin::get_plugin_workspace_status(root, targets)?.plugins {
        let source = crate::paths::get_catalog_plugin_dir(&plugin.id);
        if !source.is_dir() {
            continue;
        }
        let info = crate::core::plugin::parse_plugin_dir(source)?;
        for (name, recipe) in info.mcp_servers {
            if let Some(server) = server_map.get_mut(&name) {
                if server.source == "inline" && recipes_match(&server.recipe, &recipe) {
                    server.source = "plugin".into();
                    server.plugin = Some(plugin.id.clone());
                    for state in server.state.values_mut() {
                        if state == "inline" {
                            *state = "plugin".into();
                        }
                    }
                }
            } else if plugin.enabled {
                let key = format!("{}:{name}", plugin.id);
                server_map.insert(
                    key.clone(),
                    McpStatus {
                        name: key,
                        enabled: true,
                        targets: plugin.targets.clone(),
                        recipe: recipe.clone(),
                        source: "plugin".into(),
                        catalog: None,
                        plugin: Some(plugin.id.clone()),
                        state: plugin
                            .targets
                            .iter()
                            .map(|target| (*target, "plugin".into()))
                            .collect(),
                        deployed: plugin
                            .targets
                            .iter()
                            .map(|target| (*target, recipe.clone()))
                            .collect(),
                    },
                );
            }
        }
    }
    let mut servers: Vec<_> = server_map.into_values().collect();
    for server in &mut servers {
        for &target in targets {
            server
                .state
                .entry(target)
                .or_insert_with(|| "missing".into());
        }
    }
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(McpWorkspaceStatus {
        project_root: root.display().to_string(),
        total_count: servers.len(),
        enabled_count: servers.iter().filter(|s| s.enabled).count(),
        servers,
    })
}

pub fn package_recipe(id: &str) -> McpRecipe {
    McpRecipe {
        command: Some("npx".into()),
        args: Some(vec!["-y".into(), id.into()]),
        transport: Some(TransportType::Stdio),
        ..Default::default()
    }
}

pub fn catalog_recipe(
    id: &str,
    recipe: &McpRecipe,
    display_name: Option<&str>,
    description: Option<&str>,
) -> anyhow::Result<()> {
    validate_recipe(recipe)?;
    let mut entry = get_mcp(id)?.unwrap_or_else(|| McpCatalogEntry {
        id: id.into(),
        display_name: id.into(),
        description: String::new(),
        recipe: recipe.clone(),
        added_at: chrono::Utc::now().to_rfc3339(),
        tags: Vec::new(),
    });
    entry.recipe = recipe.clone();
    if let Some(value) = display_name {
        entry.display_name = value.into();
    }
    if let Some(value) = description {
        entry.description = value.into();
    }
    add_mcp(entry)
}

pub fn mcp_add<P: AsRef<Path>>(
    project_root: P,
    id: &str,
    targets: &[TargetName],
    custom: Option<&McpRecipe>,
) -> anyhow::Result<()> {
    let recipe = custom
        .cloned()
        .or(get_mcp(id)?.map(|e| e.recipe))
        .unwrap_or_else(|| package_recipe(id));
    validate_recipe(&recipe)?;
    let root = project_root.as_ref();
    warn_unsupported_scope(root, targets, "MCP configuration");
    // Parse every destination before applying any changes.
    for &target in targets {
        get_mcp_servers(target, get_agent_mcp_config_path(root, target))?;
    }
    for &target in targets {
        add_mcp_to_config(target, get_agent_mcp_config_path(root, target), id, &recipe)?;
    }
    Ok(())
}

pub fn mcp_remove<P: AsRef<Path>>(
    root: P,
    name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    for &target in targets {
        remove_mcp_from_config(
            target,
            get_agent_mcp_config_path(root.as_ref(), target),
            name,
        )?;
    }
    Ok(())
}

pub fn mcp_enable<P: AsRef<Path>>(
    root: P,
    name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    let entries = list_mcps()?;
    let mut changed = false;
    for &target in targets {
        let path = get_agent_mcp_config_path(root.as_ref(), target);
        let servers = get_mcp_servers(target, &path)?;
        let key = servers
            .keys()
            .find(|key| *key == name || **key == sanitize_server_key(name))
            .cloned();
        if let Some(key) = key {
            set_mcp_enabled(target, &path, &key, true)?;
            changed = true;
        } else if let Some(entry) = entries
            .iter()
            .find(|e| e.id == name || sanitize_server_key(&e.id) == name)
        {
            add_mcp_to_config(target, &path, name, &entry.recipe)?;
            changed = true;
        }
    }
    if !changed {
        bail!("No saved or catalog definition for {name}");
    }
    Ok(())
}

pub fn mcp_disable<P: AsRef<Path>>(
    root: P,
    name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    let mut found = false;
    for &target in targets {
        let path = get_agent_mcp_config_path(root.as_ref(), target);
        let servers = get_mcp_servers(target, &path)?;
        let key = servers
            .keys()
            .find(|key| *key == name || **key == sanitize_server_key(name))
            .cloned();
        if let Some(key) = key {
            set_mcp_enabled(target, &path, &key, false)?;
            found = true;
        }
    }
    if !found {
        bail!("MCP server not configured: {name}");
    }
    Ok(())
}

pub fn mcp_update(
    root: &Path,
    name: Option<&str>,
    targets: &[TargetName],
) -> anyhow::Result<Vec<String>> {
    let entries = list_mcps()?;
    let status = get_mcp_workspace_status(root, targets)?;
    let mut updated = Vec::new();
    let mut found = name.is_none();
    for server in status.servers {
        if server.source == "plugin" {
            continue;
        }
        let entry = match_entry(&entries, &server.name, &server.recipe);
        if name.is_some_and(|n| n != server.name && entry.map(|e| e.id.as_str()) != Some(n)) {
            continue;
        }
        found = true;
        let Some(entry) = entry else {
            if name.is_some() {
                bail!("Not in the catalog: {}", server.name);
            } else {
                continue;
            }
        };
        for &target in targets {
            if server
                .deployed
                .get(&target)
                .is_some_and(|recipe| !recipes_match(recipe, &entry.recipe))
            {
                add_mcp_to_config(
                    target,
                    get_agent_mcp_config_path(root, target),
                    &server.name,
                    &entry.recipe,
                )?;
                if server.state.get(&target).map(String::as_str) == Some("disabled") {
                    set_mcp_enabled(
                        target,
                        get_agent_mcp_config_path(root, target),
                        &server.name,
                        false,
                    )?;
                }
                updated.push(format!("Updated {target}: {}", server.name));
            }
        }
    }
    if !found {
        bail!("MCP server not configured: {}", name.unwrap());
    }
    Ok(updated)
}

pub fn mcp_adopt(
    root: &Path,
    name: Option<&str>,
    target: TargetName,
) -> anyhow::Result<Vec<String>> {
    let entries = list_mcps()?;
    let mut adopted = Vec::new();
    let mut found = name.is_none();
    for (key, info) in get_mcp_servers(target, get_agent_mcp_config_path(root, target))? {
        let recipe = info.recipe.context("No recipe to adopt")?;
        let entry = match_entry(&entries, &key, &recipe);
        if name.is_some_and(|n| n != key && entry.map(|e| e.id.as_str()) != Some(n)) {
            continue;
        }
        found = true;
        if entry.is_some_and(|e| recipes_match(&e.recipe, &recipe)) {
            continue;
        }
        let id = entry.map(|e| e.id.as_str()).unwrap_or(&key);
        catalog_recipe(id, &recipe, None, None)?;
        adopted.push(id.to_owned());
    }
    if !found {
        bail!("MCP server not configured: {}", name.unwrap());
    }
    Ok(adopted)
}

pub fn local_recipe(source: &Path) -> anyhow::Result<McpRecipe> {
    let dir = source
        .canonicalize()
        .context("Local MCP source directory not found")?;
    let python = dir.join("pyproject.toml");
    if python.is_file() {
        let raw: toml::Value = toml::from_str(&std::fs::read_to_string(python)?)?;
        let project = raw
            .get("project")
            .context("Missing project table in pyproject.toml")?;
        let name = project
            .get("scripts")
            .and_then(toml::Value::as_table)
            .and_then(|t| t.keys().next())
            .map(String::as_str)
            .or_else(|| project.get("name").and_then(toml::Value::as_str))
            .context("No Python entry point found")?;
        return Ok(McpRecipe {
            command: Some("uv".into()),
            args: Some(vec![
                "run".into(),
                "--directory".into(),
                dir.display().to_string(),
                name.into(),
            ]),
            transport: Some(TransportType::Stdio),
            ..Default::default()
        });
    }
    let package = dir.join("package.json");
    if package.is_file() {
        let raw = crate::storage::read_value(&package)?;
        let bin = raw
            .get("bin")
            .and_then(|v| {
                v.as_str().or_else(|| {
                    v.as_object()
                        .and_then(|o| o.values().next())
                        .and_then(serde_json::Value::as_str)
                })
            })
            .or_else(|| raw.get("main").and_then(serde_json::Value::as_str))
            .unwrap_or("index.js");
        let bun =
            bin.ends_with(".ts") || dir.join("bun.lock").exists() || dir.join("bun.lockb").exists();
        let mut args = if bun { vec!["run".into()] } else { Vec::new() };
        args.push(dir.join(bin).display().to_string());
        return Ok(McpRecipe {
            command: Some(if bun { "bun" } else { "node" }.into()),
            args: Some(args),
            transport: Some(TransportType::Stdio),
            ..Default::default()
        });
    }
    bail!(
        "No pyproject.toml or package.json in {}; use --command and --args",
        dir.display()
    )
}
