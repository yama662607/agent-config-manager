use super::*;
use crate::catalog::metadata::update_skill_metadata;
use crate::catalog::store::*;
use crate::core::placement::SkillPlacementMode;
use crate::core::skill::*;
use crate::core::skill_source::*;
use crate::storage::{object_at, update_value};
use crate::types::IssueSeverity;
use std::fs;
use std::path::Path;

fn mode(args: &PlacementArgs) -> Option<SkillPlacementMode> {
    if args.copy {
        Some(SkillPlacementMode::Copy)
    } else if args.link {
        Some(SkillPlacementMode::Link)
    } else {
        None
    }
}
fn deploy(ctx: &ContextOptions, id: &str, args: &PlacementArgs, force: bool) -> anyhow::Result<()> {
    if !ctx.catalog {
        let root = ctx.root()?;
        ctx.for_targets("skill.add", id, |target| {
            skill_add_with_options(&root, id, &[target], mode(args), force)
        })?;
    }
    Ok(())
}
fn descriptions(
    id: &str,
    display_name: Option<String>,
    description: Option<String>,
) -> anyhow::Result<()> {
    if display_name.is_some() || description.is_some() {
        update_skill_metadata(id, |meta| {
            if let Some(name) = display_name {
                meta["displayName"] = json!(name);
            }
            if let Some(description) = description {
                meta["description"] = json!(description);
            }
            Ok(())
        })?;
    }
    Ok(())
}

pub fn run(ctx: &ContextOptions, args: SkillArgs) -> anyhow::Result<()> {
    use std::io::IsTerminal;
    if args.command.is_none()
        && !args.dry_run
        && !ctx.catalog
        && !ctx.json
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
    {
        return ctx.tui(crate::tui::app::ActiveTab::Skills);
    }
    let command = args.command.unwrap_or(SkillSubcommands::List {
        all: false,
        filter: Filters::default(),
    });
    if args.dry_run {
        return preview(ctx, &command);
    }
    match command {
        SkillSubcommands::List { all, filter } => {
            let values = if ctx.catalog {
                list_skills()?
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                get_skill_workspace_status(ctx.root()?, &ctx.targets)?
                    .skills
                    .into_iter()
                    .filter(|s| all || s.enabled || s.source != "catalog")
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?
            };
            let skills = filtered(
                values,
                &filter,
                &metadata_block(&get_skills_metadata_path(), "skills")?,
            );
            if ctx.catalog {
                ctx.output(skills)
            } else {
                ctx.output(json!({"projectRoot": ctx.root()?, "totalCount": skills.len(), "enabledCount": skills.iter().filter(|s| s["enabled"] == true).count(), "skills": skills}))
            }
        }
        SkillSubcommands::Show { id } => {
            if ctx.catalog {
                let (entry, content) =
                    get_skill_with_content(&id)?.context("Skill not found in catalog")?;
                ctx.output(
                    json!({"skill": entry, "content": content, "metadata": skill_metadata(&id)?}),
                )
            } else {
                let root = ctx.root()?;
                let status = get_skill_workspace_status(&root, &ctx.targets)?
                    .skills
                    .into_iter()
                    .find(|s| s.name == id)
                    .context("Skill not found")?;
                let file = ctx
                    .targets
                    .iter()
                    .map(|&t| get_skill_path(&root, t, &id).join("SKILL.md"))
                    .find(|p| p.is_file())
                    .unwrap_or_else(|| get_catalog_skill_dir(&id).join("SKILL.md"));
                ctx.output(json!({"skill": status, "content": fs::read_to_string(file)?}))
            }
        }
        SkillSubcommands::Add {
            id,
            file,
            display_name,
            description,
            no_register,
            register: _,
            force,
            placement,
        } => {
            crate::core::validate::validate_skill_name(&id)?;
            if let Some(file) = file {
                if no_register && !ctx.catalog {
                    if file.file_name().is_some_and(|name| name == "SKILL.md") {
                        deploy_directory(
                            ctx,
                            &id,
                            file.canonicalize()?.parent().unwrap(),
                            mode(&placement).unwrap_or(SkillPlacementMode::Copy),
                            force,
                        )?;
                        return ctx.done(format!("Added skill {id} to providers"));
                    }
                    if placement.link {
                        bail!("--link with --no-register requires a SKILL.md path; use --copy for a standalone Markdown file");
                    }
                    let content = fs::read_to_string(&file)?;
                    let temp = tempfile::tempdir()?;
                    fs::write(temp.path().join("SKILL.md"), content)?;
                    deploy_directory(ctx, &id, temp.path(), SkillPlacementMode::Copy, force)?;
                    return ctx.done(format!("Added skill {id} to providers"));
                }
                if file.file_name().is_some_and(|n| n == "SKILL.md") {
                    import_skill(file.parent().unwrap_or(Path::new(".")), Some(&id), false)?;
                } else {
                    if get_skill(&id)?.is_some() {
                        bail!("Skill {id} already exists; use import --force to replace it");
                    }
                    add_skill(&id, &fs::read_to_string(file)?)?;
                }
            }
            expect_catalog_skill(&id)?;
            descriptions(&id, display_name, description)?;
            deploy(ctx, &id, &placement, force)?;
            ctx.done(format!("Added skill {id}"))
        }
        SkillSubcommands::Import {
            path,
            no_catalog,
            id,
            force,
            display_name,
            description,
            placement,
        } => {
            if no_catalog {
                if ctx.catalog {
                    bail!("--no-catalog conflicts with catalog scope");
                }
                let source = path.canonicalize()?;
                let source = if source.is_file() {
                    source.parent().unwrap().to_path_buf()
                } else {
                    source
                };
                let id = id
                    .unwrap_or_else(|| source.file_name().unwrap().to_string_lossy().into_owned());
                deploy_directory(
                    ctx,
                    &id,
                    &source,
                    mode(&placement).unwrap_or(SkillPlacementMode::Copy),
                    force,
                )?;
                return ctx.done(format!("Imported skill {id} into providers"));
            }
            let id = import_skill(&path, id.as_deref(), force)?;
            descriptions(&id, display_name, description)?;
            deploy(ctx, &id, &placement, force)?;
            ctx.done(format!("Imported skill {id}"))
        }
        SkillSubcommands::Install {
            source,
            no_catalog,
            name,
            force,
            placement,
        } => {
            if no_catalog {
                if ctx.catalog || placement.link {
                    bail!("--no-catalog requires provider scope and copy placement");
                }
                let downloaded = download_skill(&source, name.as_deref())?;
                deploy_directory(
                    ctx,
                    &downloaded.id,
                    downloaded.directory.path(),
                    SkillPlacementMode::Copy,
                    force,
                )?;
                return ctx.done(format!("Installed skill {} into providers", downloaded.id));
            }
            let id = install_skill(&source, name.as_deref(), force)?;
            deploy(ctx, &id, &placement, force)?;
            ctx.done(format!("Installed skill {id}"))
        }
        SkillSubcommands::Search { query } => ctx.output(search_skills(&query)?),
        SkillSubcommands::Update {
            id,
            force,
            placement,
        } => {
            if let Some(id) = &id {
                expect_catalog_skill(id)?;
            }
            if ctx.catalog {
                let ids: Vec<_> = list_skills()?
                    .into_iter()
                    .filter(|entry| id.as_ref().is_none_or(|id| *id == entry.id))
                    .map(|entry| entry.id)
                    .collect();
                ctx.output(crate::core::operations::collect_resources(
                    "skill.update",
                    &ids,
                    |id| {
                        let meta = skill_metadata(id)?;
                        if meta["forked"] == true && !force {
                            return Ok(json!({"id":id,"state":"forked","updated":false}));
                        }
                        let Some(source) = meta["sourceUrl"].as_str() else {
                            return Ok(json!({"id":id,"state":"no-source","updated":false}));
                        };
                        if source.starts_with("https://") {
                            install_skill(source, Some(id), true)?;
                        } else {
                            import_skill(&expand_home(source), Some(id), true)?;
                        }
                        Ok(json!({"id":id,"updated":true}))
                    },
                )?)
            } else {
                let root = ctx.root()?;
                let results =
                    ctx.for_targets("skill.update", id.as_deref().unwrap_or("*"), |target| {
                        skill_update_with_placement(
                            &root,
                            id.as_deref(),
                            &[target],
                            force,
                            mode(&placement),
                        )
                    })?;
                ctx.output(results)
            }
        }
        SkillSubcommands::Link {
            path,
            id,
            distribute,
            validate,
        } => {
            if ctx.catalog && distribute {
                bail!("--distribute requires a provider scope; omit --catalog");
            }
            if validate {
                ensure_valid(&path)?;
            }
            let id = skill_link(&path, id.as_deref(), None, ctx.home)?;
            update_skill_metadata(&id, |meta| {
                meta["sourceUrl"] = json!(format_home_path(&path.canonicalize()?));
                meta["sourceKind"] = json!("local");
                Ok(())
            })?;
            if distribute {
                let root = ctx.root()?;
                ctx.for_targets("skill.link", &id, |target| {
                    skill_add(&root, &id, &[target], None)
                })?;
            }
            ctx.done(format!("Linked skill {id}"))
        }
        SkillSubcommands::Unlink { id } => {
            skill_unlink(&id)?;
            ctx.done(format!("Unlinked skill {id}"))
        }
        SkillSubcommands::Rename {
            old_name,
            new_name,
            source,
        } => {
            let root = if ctx.catalog { home_dir() } else { ctx.root()? };
            skill_rename(
                &root,
                &old_name,
                &new_name,
                source.as_ref(),
                if ctx.catalog { &[] } else { &ctx.targets },
            )?;
            ctx.done(format!("Renamed {old_name} to {new_name}"))
        }
        SkillSubcommands::Remove { id } => {
            if ctx.catalog {
                if !remove_skill(&id)? {
                    bail!("Skill {id} not found in catalog");
                }
                update_value(&get_skills_metadata_path(), |v| {
                    object_at(v, "skills")?.remove(&id);
                    Ok(())
                })?;
            } else {
                let root = ctx.root()?;
                ctx.for_targets("skill.remove", &id, |target| {
                    skill_remove(&root, &id, &[target])
                })?;
            }
            ctx.done(format!("Removed skill {id}"))
        }
        SkillSubcommands::Enable { id } => {
            if ctx.catalog {
                bail!("Select a provider scope to enable skills");
            }
            let root = ctx.root()?;
            ctx.for_targets("skill.enable", &id, |target| {
                skill_add(&root, &id, &[target], None)
            })?;
            ctx.done(format!("Enabled skill {id}"))
        }
        SkillSubcommands::Disable { id } => {
            if ctx.catalog {
                bail!("Select a provider scope to disable skills");
            }
            let root = ctx.root()?;
            ctx.for_targets("skill.disable", &id, |target| {
                skill_remove(&root, &id, &[target])
            })?;
            ctx.done(format!("Disabled skill {id}"))
        }
        SkillSubcommands::Validate { path } => {
            let issues = crate::core::validate::validate_skill_directory(path)?;
            if issues.is_empty() && !ctx.json {
                ctx.done("SKILL.md is valid")?;
            } else {
                ctx.output(&issues)?;
            }
            if issues.iter().any(|i| i.severity == IssueSeverity::Error) {
                bail!("Skill validation failed");
            }
            Ok(())
        }
        SkillSubcommands::Meta(args) => {
            expect_catalog_skill(&args.id)?;
            if !args.pin
                && !args.unpin
                && !args.deprecated
                && !args.no_deprecated
                && !args.forked
                && !args.no_forked
                && args.tags.is_none()
                && args.category.is_none()
                && args.source.is_none()
                && args.source_ref.is_none()
            {
                return ctx.output(skill_metadata(&args.id)?);
            }
            update_skill_metadata(&args.id, |meta| {
                for (key, on, off) in [
                    ("pinned", args.pin, args.unpin),
                    ("deprecated", args.deprecated, args.no_deprecated),
                    ("forked", args.forked, args.no_forked),
                ] {
                    if on || off {
                        meta[key] = json!(on);
                    }
                }
                if let Some(tags) = args.tags {
                    meta["tags"] = json!(tags
                        .split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>());
                }
                for (key, val) in [
                    ("category", args.category),
                    ("sourceUrl", args.source),
                    ("sourceRef", args.source_ref),
                ] {
                    if let Some(val) = val {
                        meta[key] = json!(val);
                    }
                }
                Ok(())
            })?;
            ctx.output(skill_metadata(&args.id)?)
        }
        SkillSubcommands::Outdated { id, all } => ctx.output(skill_outdated(id.as_deref(), all)?),
        SkillSubcommands::Backups { id } => {
            if ctx.catalog {
                bail!("Recovery copies belong to a provider scope");
            }
            ctx.output(list_skill_backups(&ctx.root()?, &id, &ctx.targets)?)
        }
        SkillSubcommands::Restore {
            id,
            backup_id,
            force,
        } => {
            if ctx.catalog || ctx.targets.len() != 1 {
                bail!("Restore requires a provider scope and exactly one --target");
            }
            let root = ctx.root()?;
            let result = ctx.for_targets("skill.restore", &id, |target| {
                restore_skill_backup(&root, &id, &backup_id, target, force, false)
            })?;
            ctx.output(result)
        }
        SkillSubcommands::Init => ctx.tui(crate::tui::app::ActiveTab::Skills),
    }
}
fn ensure_valid(path: &Path) -> anyhow::Result<()> {
    let errors: Vec<_> = crate::core::validate::validate_skill_directory(path)?
        .into_iter()
        .filter(|i| i.severity == IssueSeverity::Error)
        .map(|i| i.message)
        .collect();
    if !errors.is_empty() {
        bail!("{}", errors.join("; "));
    }
    Ok(())
}

fn preview_source(
    ctx: &ContextOptions,
    id: &str,
    source: &Path,
    placement: &PlacementArgs,
    force: bool,
    register: bool,
) -> anyhow::Result<Value> {
    crate::core::validate::validate_skill_name(id)?;
    if !source.join("SKILL.md").is_file() {
        bail!("No SKILL.md in {}", source.display());
    }
    let mut targets = Vec::new();
    if !ctx.catalog {
        let root = ctx.root()?;
        let placement_mode = mode(placement).unwrap_or_else(|| {
            if register {
                crate::core::placement::default_placement_mode(&root)
            } else {
                SkillPlacementMode::Copy
            }
        });
        for &target in &ctx.targets {
            let registration = if target == TargetName::Grok {
                let config = get_agent_mcp_config_path(&root, target);
                let directory = if register {
                    get_catalog_skills_dir()
                } else {
                    get_agent_skills_dir(&root, target)
                };
                let registered = crate::adapters::grok::is_skill_path_registered(
                    &config,
                    &directory.display().to_string(),
                )?;
                let disabled = crate::adapters::grok::is_skill_disabled(&config, id)?;
                Some(
                    json!({"path":config,"action":if registered && !disabled {"unchanged"} else {"register"},"directory":directory,"scope":"directory-wide","blocked":false}),
                )
            } else {
                None
            };
            if target == TargetName::Grok && register {
                let mut plan = registration.unwrap();
                plan["target"] = json!(target);
                plan["skill"] = json!(id);
                targets.push(plan);
            } else {
                let mut plan = crate::core::skill_history::preview_skill_placement(
                    &root,
                    target,
                    id,
                    source,
                    placement_mode,
                    force,
                )?;
                if placement_mode == SkillPlacementMode::Link {
                    let link_source = if register {
                        get_catalog_skill_dir(id)
                    } else {
                        source.to_path_buf()
                    };
                    plan["linkTarget"] =
                        json!(crate::core::placement::stable_link_target(&link_source, id));
                }
                if !register
                    && !force
                    && fs::symlink_metadata(get_skill_path(&root, target, id)).is_ok()
                {
                    plan["blocked"] = json!(true);
                    plan["conflict"] =
                        json!("Skill already exists for this provider; use --force to replace it");
                }
                if let Some(registration) = registration {
                    plan["registration"] = registration;
                }
                targets.push(plan);
            }
        }
    }
    if register {
        let destination = get_catalog_skill_dir(id);
        let same = destination.canonicalize().ok() == source.canonicalize().ok();
        targets.push(json!({"target":"catalog","skill":id,"path":destination,"action":if same {"unchanged"} else {"import"},"blocked":fs::symlink_metadata(&destination).is_ok() && !same && !force,"changes":crate::core::change_preview::directory_changes(Some(&destination),Some(source))?}));
    }
    Ok(
        json!({"ok":true,"dryRun":true,"operation":"skill.import","blocked":targets.iter().any(|target|target["blocked"]==true),"targets":targets}),
    )
}

fn preview(ctx: &ContextOptions, command: &SkillSubcommands) -> anyhow::Result<()> {
    match command {
        SkillSubcommands::Update { id,force,placement } if !ctx.catalog => ctx.output(preview_skill_update(&ctx.root()?,id.as_deref(),&ctx.targets,*force,mode(placement))?),
        SkillSubcommands::Add { id,file:None,force,placement,.. } if !ctx.catalog => ctx.output(preview_skill_add(&ctx.root()?,id,&ctx.targets,mode(placement),*force)?),
        SkillSubcommands::Enable { id } if !ctx.catalog => ctx.output(preview_skill_add(&ctx.root()?,id,&ctx.targets,None,false)?),
        SkillSubcommands::Add { id,file:Some(file),no_register,force,placement,.. } => {
            if *no_register && !ctx.catalog && placement.link && file.file_name().is_none_or(|name| name != "SKILL.md") {
                bail!("--link with --no-register requires a SKILL.md path; use --copy for a standalone Markdown file");
            }
            let temporary = tempfile::tempdir()?;
            let source = if file.file_name().is_some_and(|name|name=="SKILL.md") { file.canonicalize()?.parent().context("Missing skill parent")?.to_path_buf() } else { fs::write(temporary.path().join("SKILL.md"),fs::read(file)?)?; temporary.path().to_path_buf() };
            let register = ctx.catalog || !no_register;
            let mut plan = preview_source(ctx,id,&source,placement,*force,register)?;
            // Add's force flag protects provider replacements; existing catalog entries are
            // replaced with the dedicated import --force operation.
            if register && fs::symlink_metadata(get_catalog_skill_dir(id)).is_ok()
                && get_catalog_skill_dir(id).canonicalize().ok() != source.canonicalize().ok() {
                for target in plan["targets"].as_array_mut().unwrap() {if target["target"]=="catalog" {target["blocked"]=json!(true);target["conflict"]=json!("Catalog skill exists; use skill import --force to replace it");}}
                plan["blocked"] = json!(true);
            }
            ctx.output(plan)
        }
        SkillSubcommands::Import { path,id,force,no_catalog,placement,.. } => {
            if ctx.catalog && *no_catalog { bail!("--no-catalog conflicts with catalog scope"); }
            let source = path.canonicalize()?;
            let source = if source.is_file() {source.parent().context("Missing skill parent")?.to_path_buf()} else {source};
            let id = id.clone().unwrap_or_else(|| source.file_name().unwrap().to_string_lossy().into_owned());
            ctx.output(preview_source(ctx,&id,&source,placement,*force,!no_catalog)?)
        }
        SkillSubcommands::Install {source,name,force,no_catalog,placement} => {
            if *no_catalog && (ctx.catalog || placement.link) { bail!("--no-catalog requires provider scope and copy placement"); }
            let skill = download_skill(source,name.as_deref())?;
            ctx.output(preview_source(ctx,&skill.id,skill.directory.path(),placement,*force,!no_catalog)?)
        }
        SkillSubcommands::Update {id,force,..} => {
            let mut results = Vec::new();
            if let Some(id)=id {expect_catalog_skill(id)?;}
            for entry in list_skills()? {
                if id.as_ref().is_some_and(|id|*id!=entry.id) {continue;}
                let meta = skill_metadata(&entry.id)?;
                if meta["forked"]==true && !force {results.push(json!({"id":entry.id,"state":"forked","skipped":true}));continue;}
                let Some(source)=meta["sourceUrl"].as_str() else {results.push(json!({"id":entry.id,"state":"no-source","skipped":true}));continue;};
                if source.starts_with("https://") {
                    let downloaded=download_skill(source,Some(&entry.id))?;
                    results.push(preview_source(ctx,&entry.id,downloaded.directory.path(),&PlacementArgs{copy:true,link:false},true,true)?);
                } else {
                    results.push(preview_source(ctx,&entry.id,&expand_home(source),&PlacementArgs{copy:true,link:false},true,true)?);
                }
            }
            ctx.output(json!({"ok":true,"dryRun":true,"operation":"skill.update","results":results}))
        }
        SkillSubcommands::Restore {id,backup_id,force} => {
            if ctx.catalog || ctx.targets.len()!=1 {bail!("Restore requires a provider scope and exactly one --target");}
            ctx.output(restore_skill_backup(&ctx.root()?,id,backup_id,ctx.targets[0],*force,true)?)
        }
        SkillSubcommands::Remove {id} | SkillSubcommands::Disable {id} => {
            if ctx.catalog && matches!(command,SkillSubcommands::Disable{..}) {bail!("Select a provider scope to disable skills");}
            let mut changes=Vec::new();
            if ctx.catalog {
                expect_catalog_skill(id)?;
                changes.push(json!({"target":"catalog","path":get_catalog_skill_dir(id),"action":"remove","metadataPath":get_skills_metadata_path()}));
            } else {
                let root=ctx.root()?;
                for &target in &ctx.targets {
                    let path=get_skill_path(&root,target,id);
                    changes.push(json!({"target":target,"path":if target==TargetName::Grok {get_agent_mcp_config_path(&root,target)} else {path.clone()},"action":if target==TargetName::Grok {"disable"} else if fs::symlink_metadata(&path).is_ok_and(|m|m.file_type().is_symlink()) {"unlink"} else {"remove"},"exists":path.exists()}));
                }
            }
            ctx.output(json!({"ok":true,"dryRun":true,"operation":"skill.remove","resource":id,"changes":changes}))
        }
        SkillSubcommands::Link {path,id,distribute,validate} => {
            if ctx.catalog && *distribute {bail!("--distribute requires a provider scope");}
            if *validate {ensure_valid(path)?;}
            let source=path.canonicalize()?;
            let id=id.clone().unwrap_or_else(||source.file_name().unwrap().to_string_lossy().into_owned());
            crate::core::validate::validate_skill_name(&id)?;
            if !source.join("SKILL.md").is_file(){bail!("No SKILL.md in source");}
            let destination=get_catalog_skill_dir(&id);
            let same = destination.canonicalize().ok() == Some(source.clone());
            let existing_real = fs::symlink_metadata(&destination).is_ok_and(|m|!m.file_type().is_symlink());
            let blocked = (!same && existing_real) || source.starts_with(&destination);
            let mut value=json!({"ok":true,"dryRun":true,"operation":"skill.link","source":source,"linkTarget":source,"path":destination,"blocked":blocked});
            if *distribute {
                let mut distribution=preview_source(ctx,&id,&source,&PlacementArgs{copy:false,link:false},false,true)?;
                distribution["targets"].as_array_mut().unwrap().retain(|plan|plan["target"]!="catalog");
                distribution["operation"] = json!("skill.add");
                let distribution_blocked=distribution["targets"].as_array().unwrap().iter().any(|plan|plan["blocked"]==true);
                distribution["blocked"]=json!(distribution_blocked);
                value["blocked"]=json!(blocked || distribution_blocked);
                value["distribution"]=distribution;
            }
            ctx.output(value)
        }
        SkillSubcommands::Unlink {id} => {
            let path=get_catalog_skill_dir(id);
            if !fs::symlink_metadata(&path)?.file_type().is_symlink(){bail!("Skill is not a development link");}
            ctx.output(json!({"ok":true,"dryRun":true,"operation":"skill.unlink","path":path}))
        }
        SkillSubcommands::Rename {old_name,new_name,source} => {
            crate::core::validate::validate_skill_name(new_name)?;
            expect_catalog_skill(old_name)?;
            let mut changes=vec![json!({"target":"catalog","from":get_catalog_skill_dir(old_name),"to":get_catalog_skill_dir(new_name),"blocked":fs::symlink_metadata(get_catalog_skill_dir(new_name)).is_ok(),"newSource":source})];
            if !ctx.catalog {let root=ctx.root()?;for &target in &ctx.targets {let destination=get_skill_path(&root,target,new_name);changes.push(json!({"target":target,"from":get_skill_path(&root,target,old_name),"to":destination,"blocked":fs::symlink_metadata(destination).is_ok()}));}}
            ctx.output(json!({"ok":true,"dryRun":true,"operation":"skill.rename","blocked":changes.iter().any(|value|value["blocked"]==true),"changes":changes}))
        }
        SkillSubcommands::Add {id,..} => {expect_catalog_skill(id)?;ctx.output(json!({"ok":true,"dryRun":true,"operation":"skill.add","resource":id,"path":get_skills_metadata_path()}))}
        _ => bail!("--dry-run supports skill add/import/install/update/enable/disable/remove/link/unlink/rename/restore"),
    }
}

fn deploy_directory(
    ctx: &ContextOptions,
    id: &str,
    source: &Path,
    mode: SkillPlacementMode,
    force: bool,
) -> anyhow::Result<()> {
    crate::core::validate::validate_skill_name(id)?;
    let root = ctx.root()?;
    for &target in &ctx.targets {
        if !force && fs::symlink_metadata(get_skill_path(&root, target, id)).is_ok() {
            bail!("Skill {id} already exists for {target}; use --force to replace it");
        }
    }
    ctx.for_targets("skill.deploy", id, |target| {
        crate::core::placement::copy_skill_dir_to_config_with_options(
            &root, target, id, source, mode, force,
        )?;
        if target == TargetName::Grok {
            let config = get_agent_mcp_config_path(&root, target);
            crate::adapters::grok::register_skill_path(
                &config,
                &get_agent_skills_dir(&root, target).display().to_string(),
            )?;
            crate::adapters::grok::set_skill_disabled(&config, id, false)?;
        }
        Ok(())
    })?;
    Ok(())
}
