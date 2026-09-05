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
        && !ctx.catalog
        && !ctx.json
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
    {
        return ctx.tui(crate::tui::app::ActiveTab::Mcp);
    }
    match args
        .command
        .unwrap_or(McpSubcommands::List(Filters::default()))
    {
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
                mcp_add(ctx.root()?, &args.id, &ctx.targets, Some(&value))?;
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
                for &target in &ctx.targets {
                    let path = get_agent_mcp_config_path(&root, target);
                    let servers = crate::adapters::get_mcp_servers(target, &path)?;
                    if let Some((key, server)) = servers.iter().find(|(key, _)| {
                        **key == id || **key == crate::adapters::sanitize_server_key(&id)
                    }) {
                        planned.push((
                            target,
                            path,
                            key.clone(),
                            recipe(&id, &args, server.recipe.clone())?,
                            server.enabled,
                        ));
                    }
                }
                if planned.is_empty() {
                    bail!("MCP {id} is not configured in this scope");
                }
                for (target, path, key, value, enabled) in planned {
                    crate::adapters::add_mcp_to_config(target, &path, &key, &value)?;
                    if !enabled {
                        crate::adapters::set_mcp_enabled(target, &path, &key, false)?;
                    }
                }
            }
            ctx.done(format!("Edited MCP {id}"))
        }
        McpSubcommands::Remove { id } => {
            if ctx.catalog {
                if !remove_mcp(&id)? {
                    bail!("MCP {id} not found in catalog");
                }
            } else {
                mcp_remove(ctx.root()?, &id, &ctx.targets)?;
            }
            ctx.done(format!("Removed MCP {id}"))
        }
        McpSubcommands::Enable { id } => {
            provider_scope(ctx)?;
            mcp_enable(ctx.root()?, &id, &ctx.targets)?;
            ctx.done(format!("Enabled MCP {id}"))
        }
        McpSubcommands::Disable { id } => {
            provider_scope(ctx)?;
            mcp_disable(ctx.root()?, &id, &ctx.targets)?;
            ctx.done(format!("Disabled MCP {id}"))
        }
        McpSubcommands::Update { id } => {
            provider_scope(ctx)?;
            ctx.output(mcp_update(&ctx.root()?, id.as_deref(), &ctx.targets)?)
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
