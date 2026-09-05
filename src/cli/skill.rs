use super::*;
use crate::catalog::metadata::update_skill_metadata;
use crate::catalog::store::*;
use crate::core::placement::{copy_skill_dir_to_config, SkillPlacementMode};
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
fn deploy(ctx: &ContextOptions, id: &str, args: &PlacementArgs) -> anyhow::Result<()> {
    if !ctx.catalog {
        skill_add(ctx.root()?, id, &ctx.targets, mode(args))?;
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
        && !ctx.catalog
        && !ctx.json
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
    {
        return ctx.tui(crate::tui::app::ActiveTab::Skills);
    }
    match args.command.unwrap_or(SkillSubcommands::List {
        all: false,
        filter: Filters::default(),
    }) {
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
                            SkillPlacementMode::Copy,
                            false,
                        )?;
                        return ctx.done(format!("Added skill {id} to providers"));
                    }
                    let content = fs::read_to_string(&file)?;
                    let temp = tempfile::tempdir()?;
                    fs::write(temp.path().join("SKILL.md"), content)?;
                    let root = ctx.root()?;
                    for &target in &ctx.targets {
                        copy_skill_dir_to_config(
                            &root,
                            target,
                            &id,
                            temp.path(),
                            SkillPlacementMode::Copy,
                        )?;
                        if target == TargetName::Grok {
                            crate::adapters::grok::register_skill_path(
                                get_agent_mcp_config_path(&root, target),
                                &get_agent_skills_dir(&root, target).display().to_string(),
                            )?;
                        }
                    }
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
            deploy(ctx, &id, &placement)?;
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
            deploy(ctx, &id, &placement)?;
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
            deploy(ctx, &id, &placement)?;
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
                let mut results = Vec::new();
                for entry in list_skills()? {
                    if id.as_ref().is_some_and(|id| *id != entry.id) {
                        continue;
                    }
                    let meta = skill_metadata(&entry.id)?;
                    if meta["forked"] == true && !force {
                        results.push(json!({"id": entry.id, "state": "forked", "updated": false}));
                        continue;
                    }
                    let Some(source) = meta["sourceUrl"].as_str() else {
                        results
                            .push(json!({"id": entry.id, "state": "no-source", "updated": false}));
                        continue;
                    };
                    if source.starts_with("https://") {
                        install_skill(source, Some(&entry.id), true)?;
                    } else {
                        import_skill(&expand_home(source), Some(&entry.id), true)?;
                    }
                    results.push(json!({"id": entry.id, "updated": true}));
                }
                ctx.output(results)
            } else if mode(&placement).is_some() {
                let root = ctx.root()?;
                let status = get_skill_workspace_status(&root, &ctx.targets)?;
                let mut updated = Vec::new();
                for entry in status.skills {
                    if id.as_ref().is_some_and(|id| *id != entry.name)
                        || get_skill(&entry.name)?.is_none()
                    {
                        continue;
                    }
                    for &target in &ctx.targets {
                        if force || entry.targets.contains(&target) {
                            skill_add(&root, &entry.name, &[target], mode(&placement))?;
                            updated.push(format!("{target}/{}", entry.name));
                        }
                    }
                }
                ctx.output(updated)
            } else {
                ctx.output(skill_update(
                    ctx.root()?,
                    id.as_deref(),
                    &ctx.targets,
                    force,
                )?)
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
            let id = skill_link(
                &path,
                id.as_deref(),
                if distribute { Some(&ctx.targets) } else { None },
                ctx.home,
            )?;
            update_skill_metadata(&id, |meta| {
                meta["sourceUrl"] = json!(format_home_path(&path.canonicalize()?));
                meta["sourceKind"] = json!("local");
                Ok(())
            })?;
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
                skill_remove(ctx.root()?, &id, &ctx.targets)?;
            }
            ctx.done(format!("Removed skill {id}"))
        }
        SkillSubcommands::Enable { id } => {
            if ctx.catalog {
                bail!("Select a provider scope to enable skills");
            }
            skill_add(ctx.root()?, &id, &ctx.targets, None)?;
            ctx.done(format!("Enabled skill {id}"))
        }
        SkillSubcommands::Disable { id } => {
            if ctx.catalog {
                bail!("Select a provider scope to disable skills");
            }
            skill_remove(ctx.root()?, &id, &ctx.targets)?;
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
    for &target in &ctx.targets {
        copy_skill_dir_to_config(&root, target, id, source, mode)?;
        if target == TargetName::Grok {
            let config = get_agent_mcp_config_path(&root, target);
            crate::adapters::grok::register_skill_path(
                &config,
                &get_agent_skills_dir(&root, target).display().to_string(),
            )?;
            crate::adapters::grok::set_skill_disabled(&config, id, false)?;
        }
    }
    Ok(())
}
