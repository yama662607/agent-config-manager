use super::*;
use crate::core::discovery::*;
use crate::core::plugin::*;

pub fn run(ctx: &ContextOptions, args: PluginArgs) -> anyhow::Result<()> {
    use std::io::IsTerminal;
    if args.command.is_none()
        && !ctx.catalog
        && !ctx.json
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
    {
        return ctx.tui(crate::tui::app::ActiveTab::Plugins);
    }
    match args.command.unwrap_or(PluginSubcommands::List { verify: false }) {
        PluginSubcommands::List { verify } => {
            let plugins = get_plugin_workspace_status(&ctx.plugin_root()?, &ctx.targets)?.plugins;
            if verify {
                if ctx.catalog { bail!("Native verification requires a provider scope"); }
                let verification = crate::core::plugin_verification::verify_plugins(&ctx.plugin_root()?, &[], &ctx.targets, false)?;
                ctx.output(json!({"plugins":plugins,"verification":verification}))
            } else { ctx.output(plugins) }
        }
        PluginSubcommands::Verify { ids, reconcile } => {
            if ctx.catalog { bail!("Native verification requires a provider scope"); }
            ctx.output(crate::core::plugin_verification::verify_plugins(&ctx.plugin_root()?, &ids, &ctx.targets, reconcile)?)
        }
        PluginSubcommands::Compatibility { id, all } => {
            let ids = match id { Some(id) if !all => vec![id], _ => catalog_plugin_ids()? };
            ctx.output(ids.iter().map(|id| crate::core::plugin_verification::compatibility_report(id, &ctx.targets)).collect::<anyhow::Result<Vec<_>>>()?)
        }
        PluginSubcommands::Show { id } => ctx.output(json!({"plugin": get_plugin_status(&ctx.plugin_root()?, &id, &ctx.targets)?, "metadata": plugin_metadata(&id)?})),
        PluginSubcommands::Add { path, id } => { let id = plugin_add_to_catalog(path, id.as_deref())?; ctx.done(format!("Linked plugin {id}")) }
        PluginSubcommands::Import { path, id, force } => { let id = plugin_import(&path, id.as_deref(), force)?; ctx.done(format!("Imported plugin {id}")) }
        PluginSubcommands::Install { id } => {
            if ctx.catalog { bail!("Native plugin installation requires a provider scope; omit --catalog"); }
            let value=plugin_install(&ctx.plugin_root()?, &id, &ctx.targets)?;
            ctx.completed_targets("plugin.install",&id)?;
            ctx.output(value)
        }
        PluginSubcommands::Remove { id, keep_skills } => {
            if ctx.catalog {
                plugin_remove_from_catalog(&id)?;
                return ctx.done(format!("Removed catalog plugin {id}"));
            }
            let root = ctx.plugin_root()?;
            if keep_skills {
                let plugin = get_plugin_status(&root, &id, &ctx.targets)?;
                let temp = tempfile::tempdir()?;
                assemble_plugin(&id, &temp.path().join("plugin"))?;
                for skill in plugin.skills {
                    let source = temp.path().join("plugin/skills").join(&skill);
                    if !get_catalog_skill_dir(&skill).is_dir() || std::fs::symlink_metadata(get_catalog_skill_dir(&skill))?.file_type().is_symlink() {
                        crate::core::skill_source::import_skill(&source, Some(&skill), true)?;
                    }
                    ctx.for_targets("plugin.keep-skills",&skill,|target|crate::core::skill::skill_add(&root, &skill, &[target], None))?;
                }
            }
            plugin_remove(&root, &id, &ctx.targets)?;
            ctx.completed_targets("plugin.remove",&id)?;
            ctx.done(format!("Uninstalled plugin {id}"))
        }
        PluginSubcommands::Unlink { id } => { plugin_unlink_from_catalog(&id)?; ctx.done(format!("Unlinked plugin {id}")) }
        PluginSubcommands::Convert { id, all, dry_run, assemble_only } => {
            let ids = if all { catalog_plugin_ids()? } else { vec![id.context("Specify a plugin id or --all")?] };
            let compatibility = ids.iter().map(|id| crate::core::plugin_verification::compatibility_report(id, &ctx.targets)).collect::<anyhow::Result<Vec<_>>>()?;
            if dry_run { return ctx.output(json!({"dryRun": true, "plugins": ids, "marketplace": get_catalog_dir().join("marketplace"),"compatibility":compatibility})); }
            let marketplace = build_marketplace(&ids)?;
            if !assemble_only && !ctx.catalog { let root=ctx.plugin_root()?;ctx.for_targets("plugin.convert","marketplace",|target|register_marketplace(&root, &[target], &marketplace))?; }
            ctx.output(json!({"plugins": ids, "marketplace": marketplace,"compatibility":compatibility}))
        }
        PluginSubcommands::Update { ids, all, dry_run, force } => {
            let ids = if all || ids.is_empty() { catalog_plugin_ids()? } else { ids };
            let root = ctx.plugin_root()?;
            ctx.output(crate::core::operations::collect_resources("plugin.update",&ids,|id|Ok(serde_json::to_value(plugin_update_options(&root,id,if ctx.catalog {&[]} else {&ctx.targets},force,dry_run)?)?))?)
        }
        PluginSubcommands::Discover { import, root } => {
            let roots = if root.is_empty() { let mut roots = provider_plugin_roots(); roots.extend(desktop_roots()); roots } else { root.into_iter().map(|p| (p, ctx.targets[0])).collect() };
            let found = discover_plugins(&roots, 8)?;
            if import {
                for plugin in &found {
                    if !catalog_plugin_ids()?.contains(&plugin.name) { plugin_import(&plugin.source_path, Some(&plugin.name), false)?; }
                }
            }
            ctx.output(found)
        }
        PluginSubcommands::Scan { diff } => { if diff { ctx.output(snapshot(false)?) } else { ctx.output(plugin_scan()?) } }
        PluginSubcommands::Snapshot => ctx.output(snapshot(true)?),
        PluginSubcommands::Repair { apply } => ctx.output(plugin_repair(apply)?),
        PluginSubcommands::Doctor => {
            let findings = plugin_drift()?;
            let failed = findings.as_array().is_some_and(|values| values.iter().any(|v| v["state"] == "missing"));
            ctx.output(findings)?;
            if failed { bail!("Plugin sources are missing; run plugin discover and repair"); }
            Ok(())
        }
    }
}
