use super::*;
use crate::catalog::store::{get_mcp, list_mcps, remove_mcp};
use crate::core::mcp::*;
use crate::types::{McpRecipe, TransportType};

fn recipe(id: &str, args: &RecipeArgs, base: Option<McpRecipe>) -> anyhow::Result<McpRecipe> {
    let mut recipe = if let Some(local) = &args.local {
        local_recipe(local)?
    } else if let Some(package) = &args.from_package {
        package_recipe(package)
    } else {
        base.unwrap_or_else(|| package_recipe(id))
    };
    if let Some(command) = &args.command {
        recipe.command = Some(command.clone());
        recipe.url = None;
        recipe.transport = Some(TransportType::Stdio);
    }
    if let Some(url) = &args.url {
        recipe.url = Some(url.clone());
        recipe.command = None;
        recipe.args = None;
        recipe.transport = Some(TransportType::Http);
    }
    if !args.args.is_empty() {
        recipe.args = Some(args.args.clone());
    }
    if let Some(json) = &args.args_json {
        recipe.args =
            Some(serde_json::from_str(json).context("--args must be a JSON array of strings")?);
    }
    if let Some(cwd) = &args.cwd {
        recipe.cwd = Some(cwd.clone());
    }
    if !args.env.is_empty() {
        let mut env = recipe.env.take().unwrap_or_default();
        for value in &args.env {
            if value.trim().starts_with('{') {
                let supplied: std::collections::HashMap<String, String> =
                    serde_json::from_str(value)
                        .context("--env JSON must map variable names to strings")?;
                env.extend(supplied);
                continue;
            }
            let (key, value) = value.split_once('=').context("--env requires KEY=VALUE")?;
            if key.is_empty() {
                bail!("Environment variable name cannot be empty");
            }
            env.insert(key.into(), value.into());
        }
        recipe.env = Some(env);
    }
    crate::adapters::validate_recipe(&recipe)?;
    Ok(recipe)
}

pub fn run(ctx: &ContextOptions, args: McpArgs) -> anyhow::Result<()> {
    use std::io::IsTerminal;
    if args.command.is_none()
        && !args.dry_run
        && !ctx.catalog
        && !ctx.json
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
    {
        return ctx.tui(crate::tui::app::ActiveTab::Mcp);
    }
    let command = args
        .command
        .unwrap_or(McpSubcommands::List(Filters::default()));
    if args.dry_run {
        return preview(ctx, &command);
    }
    match command {
        McpSubcommands::List(filter) => {
            let metadata = metadata_block(&get_mcps_metadata_path(), "mcps")?;
            if ctx.catalog {
                let items = list_mcps()?
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?;
                ctx.output(filtered(items, &filter, &metadata))
            } else {
                let root = ctx.root()?;
                let items = get_mcp_workspace_status(&root, &ctx.targets)?
                    .servers
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?;
                let servers = filtered(items, &filter, &metadata);
                ctx.output(json!({"projectRoot": root, "totalCount": servers.len(), "enabledCount": servers.iter().filter(|s| s["enabled"] == true).count(), "servers": servers}))
            }
        }
        McpSubcommands::Show { id } => {
            if ctx.catalog {
                ctx.output(get_mcp(&id)?.context("MCP not found in catalog")?)
            } else {
                ctx.output(
                    get_mcp_workspace_status(ctx.root()?, &ctx.targets)?
                        .servers
                        .into_iter()
                        .find(|s| {
                            s.name == id || s.name == crate::adapters::sanitize_server_key(&id)
                        })
                        .context("MCP not configured in this scope")?,
                )
            }
        }
        McpSubcommands::Add(args) => {
            let value = recipe(&args.id, &args.recipe, get_mcp(&args.id)?.map(|e| e.recipe))?;
            if !ctx.catalog {
                let root = ctx.root()?;
                ctx.for_targets("mcp.add", &args.id, |target| {
                    mcp_add(&root, &args.id, &[target], Some(&value))
                })?;
            }
            if ctx.catalog || !args.no_register {
                catalog_recipe(
                    &args.id,
                    &value,
                    args.display_name.as_deref(),
                    args.description.as_deref(),
                )?;
            }
            ctx.done(format!("Added MCP {}", args.id))
        }
        McpSubcommands::Edit { id, recipe: args } => {
            if ctx.catalog {
                let old = get_mcp(&id)?.context("MCP not found in catalog")?;
                catalog_recipe(&id, &recipe(&id, &args, Some(old.recipe))?, None, None)?;
            } else {
                let root = ctx.root()?;
                let mut planned = Vec::new();
                let catalog = list_mcps()?;
                for &target in &ctx.targets {
                    let path = get_agent_mcp_config_path(&root, target);
                    let servers = crate::adapters::get_mcp_servers(target, &path)?;
                    if let Some((key, server)) = resolve_native_server(&servers, &catalog, &id)? {
                        planned.push((
                            target,
                            path,
                            key.clone(),
                            recipe(&id, &args, server.recipe.clone())?,
                            server.clone(),
                        ));
                    }
                }
                if planned.is_empty() {
                    bail!("MCP {id} is not configured in this scope");
                }
                ctx.for_targets("mcp.edit", &id, |target| {
                    if let Some((_, path, key, value, expected)) =
                        planned.iter().find(|(t, ..)| *t == target)
                    {
                        crate::adapters::replace_mcp_recipe(target, path, key, expected, value)?;
                        return Ok(json!({"changed":true}));
                    }
                    Ok(json!({"changed":false,"reason":"not configured"}))
                })?;
            }
            ctx.done(format!("Edited MCP {id}"))
        }
        McpSubcommands::Remove { id } => {
            if ctx.catalog {
                if !remove_mcp(&id)? {
                    bail!("MCP {id} not found in catalog");
                }
            } else {
                let root = ctx.root()?;
                ctx.for_targets("mcp.remove", &id, |target| {
                    mcp_remove(&root, &id, &[target])
                })?;
            }
            ctx.done(format!("Removed MCP {id}"))
        }
        McpSubcommands::Enable { id } => {
            provider_scope(ctx)?;
            let root = ctx.root()?;
            ctx.for_targets("mcp.enable", &id, |target| {
                mcp_enable(&root, &id, &[target])
            })?;
            ctx.done(format!("Enabled MCP {id}"))
        }
        McpSubcommands::Disable { id } => {
            provider_scope(ctx)?;
            let root = ctx.root()?;
            ctx.for_targets("mcp.disable", &id, |target| {
                mcp_disable(&root, &id, &[target])
            })?;
            ctx.done(format!("Disabled MCP {id}"))
        }
        McpSubcommands::Update { id } => {
            provider_scope(ctx)?;
            let root = ctx.root()?;
            if let Some(id) = &id {
                if !get_mcp_workspace_status(&root, &ctx.targets)?
                    .servers
                    .iter()
                    .any(|s| s.name == *id)
                {
                    bail!("MCP server not configured: {id}");
                }
            }
            let results =
                ctx.for_targets("mcp.update", id.as_deref().unwrap_or("*"), |target| {
                    if id.as_ref().is_some_and(|id| {
                        get_mcp_workspace_status(&root, &[target])
                            .is_ok_and(|s| !s.servers.iter().any(|s| &s.name == id))
                    }) {
                        return Ok(Vec::new());
                    }
                    mcp_update(&root, id.as_deref(), &[target])
                })?;
            ctx.output(results)
        }
        McpSubcommands::Adopt { id } => {
            provider_scope(ctx)?;
            if ctx.targets.len() != 1 {
                bail!("Choose one source provider with --target for mcp adopt");
            }
            ctx.output(mcp_adopt(&ctx.root()?, id.as_deref(), ctx.targets[0])?)
        }
        McpSubcommands::Init => ctx.tui(crate::tui::app::ActiveTab::Mcp),
    }
}
fn provider_scope(ctx: &ContextOptions) -> anyhow::Result<()> {
    if ctx.catalog {
        bail!("This operation requires a provider scope (--home or --project)");
    }
    Ok(())
}

fn preview(ctx: &ContextOptions, command: &McpSubcommands) -> anyhow::Result<()> {
    use crate::core::operations::redact_value;
    let action = match command {
        McpSubcommands::Add(_) => "add",
        McpSubcommands::Edit { .. } => "edit",
        McpSubcommands::Remove { .. } => "remove",
        McpSubcommands::Enable { .. } => "enable",
        McpSubcommands::Disable { .. } => "disable",
        McpSubcommands::Update { .. } => "update",
        McpSubcommands::Adopt { .. } => "adopt",
        _ => bail!("--dry-run requires an MCP mutation command"),
    };
    let mut changes = Vec::new();
    let mut add_change = |target: Value, path: PathBuf, id: &str, before: Value, after: Value| {
        let changed = before != after;
        let before_fields = before.as_object().cloned().unwrap_or_default();
        let after_fields = after.as_object().cloned().unwrap_or_default();
        let keys: std::collections::BTreeSet<_> = before_fields
            .keys()
            .chain(after_fields.keys())
            .cloned()
            .collect();
        let fields: Vec<_> = keys
            .into_iter()
            .filter(|key| before_fields.get(key) != after_fields.get(key))
            .collect();
        changes.push(json!({"target":target,"path":path,"resource":id,"action":action,"changed":changed,"changedFields":fields,"before":redact_value(&before),"after":redact_value(&after)}));
    };
    if ctx.catalog {
        let (id, before, after) = match command {
            McpSubcommands::Add(args) => {
                let old = get_mcp(&args.id)?.map(|entry| entry.recipe);
                let value = recipe(&args.id, &args.recipe, old.clone())?;
                (
                    &args.id,
                    serde_json::to_value(old)?,
                    serde_json::to_value(value)?,
                )
            }
            McpSubcommands::Edit { id, recipe: args } => {
                let old = get_mcp(id)?.context("MCP not found in catalog")?.recipe;
                let value = recipe(id, args, Some(old.clone()))?;
                (id, serde_json::to_value(old)?, serde_json::to_value(value)?)
            }
            McpSubcommands::Remove { id } => (
                id,
                serde_json::to_value(get_mcp(id)?.context("MCP not found in catalog")?.recipe)?,
                Value::Null,
            ),
            _ => bail!("This operation requires a provider scope"),
        };
        add_change(json!("catalog"), get_catalog_path(), id, before, after);
    } else {
        let root = ctx.root()?;
        if matches!(command, McpSubcommands::Adopt { .. }) && ctx.targets.len() != 1 {
            bail!("Choose one source provider with --target for mcp adopt");
        }
        let catalog = list_mcps()?;
        let mut matched = false;
        for &target in &ctx.targets {
            let path = get_agent_mcp_config_path(&root, target);
            let servers = crate::adapters::get_mcp_servers(target, &path)?;
            let specific = match command {
                McpSubcommands::Add(args) => Some(args.id.as_str()),
                McpSubcommands::Edit { id, .. }
                | McpSubcommands::Remove { id }
                | McpSubcommands::Enable { id }
                | McpSubcommands::Disable { id } => Some(id.as_str()),
                McpSubcommands::Update { id } | McpSubcommands::Adopt { id } => id.as_deref(),
                _ => None,
            };
            let ids: Vec<_> = specific.map(|id| vec![id.to_owned()]).unwrap_or_else(|| {
                let mut ids: Vec<_> = servers.keys().cloned().collect();
                ids.sort();
                ids
            });
            for id in ids {
                let add_key = if let McpSubcommands::Add(args) = command {
                    let value = recipe(
                        &args.id,
                        &args.recipe,
                        get_mcp(&args.id)?.map(|entry| entry.recipe),
                    )?;
                    Some(crate::adapters::preview_mcp_add(
                        target, &path, &args.id, &value,
                    )?)
                } else {
                    None
                };
                let resolved = if let Some(key) = &add_key {
                    servers.get_key_value(key)
                } else {
                    resolve_native_server(&servers, &catalog, &id)?
                };
                let current = resolved.map(|(_, server)| server);
                let old = current.and_then(|entry| entry.recipe.clone());
                let catalog_entry = old
                    .as_ref()
                    .and_then(|recipe| match_entry(&catalog, &id, recipe))
                    .or_else(|| catalog.iter().find(|entry| entry.id == id));
                let before = current
                    .map(|entry| json!({"enabled":entry.enabled,"recipe":entry.recipe}))
                    .unwrap_or(Value::Null);
                let enabled = current.is_some_and(|entry| entry.enabled);
                let after = match command {
                    McpSubcommands::Add(args) => {
                        json!({"enabled":true,"recipe":recipe(&args.id,&args.recipe,get_mcp(&args.id)?.map(|entry|entry.recipe))?})
                    }
                    McpSubcommands::Edit { recipe: args, .. } => {
                        if current.is_none() {
                            continue;
                        }
                        json!({"enabled":enabled,"recipe":recipe(&id,args,old.clone())?})
                    }
                    McpSubcommands::Remove { .. } => Value::Null,
                    McpSubcommands::Enable { .. } => {
                        json!({"enabled":true,"recipe":old.clone().or_else(||catalog_entry.map(|entry|entry.recipe.clone())).context("No saved or catalog MCP definition")?})
                    }
                    McpSubcommands::Disable { .. } => {
                        if current.is_none() {
                            bail!("MCP server not configured: {id} for {target}");
                        }
                        json!({"enabled":false,"recipe":old})
                    }
                    McpSubcommands::Update { .. } => {
                        if current.is_none() {
                            continue;
                        }
                        let Some(entry) = catalog_entry else {
                            if specific.is_some() {
                                bail!("MCP {id} is not in the catalog");
                            }
                            continue;
                        };
                        crate::adapters::validate_recipe(&entry.recipe)
                            .with_context(|| format!("Invalid catalog MCP: {}", entry.id))?;
                        json!({"enabled":enabled,"recipe":entry.recipe})
                    }
                    McpSubcommands::Adopt { .. } => {
                        let Some(old) = old else {
                            continue;
                        };
                        add_change(
                            json!("catalog"),
                            get_catalog_path(),
                            catalog_entry.map(|entry| entry.id.as_str()).unwrap_or(&id),
                            serde_json::to_value(catalog_entry.map(|entry| &entry.recipe))?,
                            serde_json::to_value(old)?,
                        );
                        matched = true;
                        continue;
                    }
                    _ => unreachable!(),
                };
                matched = true;
                add_change(json!(target), path.clone(), &id, before, after);
            }
        }
        if !matched
            && matches!(
                command,
                McpSubcommands::Edit { .. }
                    | McpSubcommands::Update { id: Some(_) }
                    | McpSubcommands::Adopt { id: Some(_) }
            )
        {
            bail!("MCP is not configured in this scope");
        }
        if let McpSubcommands::Add(args) = command {
            if !args.no_register {
                let old = get_mcp(&args.id)?.map(|entry| entry.recipe);
                let after = recipe(&args.id, &args.recipe, old.clone())?;
                add_change(
                    json!("catalog"),
                    get_catalog_path(),
                    &args.id,
                    serde_json::to_value(old)?,
                    serde_json::to_value(after)?,
                );
            }
        }
    }
    ctx.output(
        json!({"ok":true,"dryRun":true,"operation":format!("mcp.{action}"),"changes":changes}),
    )
}
