use crate::adapters::grok::{register_skill_path, set_skill_disabled};
use crate::catalog::store::list_skills;
use crate::core::placement::{
    copy_skill_dir_to_config_with_options, default_placement_mode, inspect_skill_placement,
    SkillPlacementMode,
};
use crate::core::validate::validate_skill_name;
use crate::paths::{
    get_agent_mcp_config_path, get_agent_skills_dir, get_catalog_skill_dir, get_catalog_skills_dir,
    get_skill_path, home_dir,
};
use crate::types::{SkillPlacementState, SkillStatus, SkillWorkspaceStatus, TargetName};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillUpdateResult {
    pub updated_count: usize,
    pub skipped_count: usize,
    pub details: Vec<SkillUpdateDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUpdateDetail {
    pub skill_name: String,
    pub target: TargetName,
    pub updated: bool,
    pub reason: String,
}

/// Get status of all skills across targets for a workspace (including catalog-only skills)
pub fn get_skill_workspace_status<P: AsRef<Path>>(
    project_root: P,
    targets: &[TargetName],
) -> anyhow::Result<SkillWorkspaceStatus> {
    let root = project_root.as_ref();
    let catalog_entries = list_skills()?;
    let catalog_skills: HashSet<String> = catalog_entries.iter().map(|s| s.id.clone()).collect();

    let mut skill_map: HashMap<String, SkillStatus> = HashMap::new();

    // 1. First add all catalog skills
    for cat in catalog_entries {
        skill_map.insert(
            cat.id.clone(),
            SkillStatus {
                name: cat.id,
                enabled: false,
                targets: Vec::new(),
                source: "catalog".to_string(),
                placement: HashMap::new(),
            },
        );
    }

    // 2. Scan each target directory
    for &target in targets {
        if target == TargetName::Grok {
            let config = get_agent_mcp_config_path(root, target);
            for registered in crate::adapters::grok::skill_paths(&config)? {
                let dir = crate::paths::expand_home(&registered);
                if !dir.is_dir() {
                    continue;
                }
                for entry in fs::read_dir(&dir)? {
                    let entry = entry?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !entry.path().join("SKILL.md").is_file()
                        || validate_skill_name(&name).is_err()
                    {
                        continue;
                    }
                    let disabled = crate::adapters::grok::is_skill_disabled(&config, &name)?;
                    let status = skill_map
                        .entry(name.clone())
                        .or_insert_with(|| SkillStatus {
                            name: name.clone(),
                            enabled: false,
                            targets: Vec::new(),
                            source: "inline".into(),
                            placement: HashMap::new(),
                        });
                    if !disabled {
                        status.enabled = true;
                        if !status.targets.contains(&target) {
                            status.targets.push(target);
                        }
                        status
                            .placement
                            .insert(target, SkillPlacementState::Registered);
                    }
                }
            }
        }
        let skills_dir = get_agent_skills_dir(root, target);
        if skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let meta = fs::symlink_metadata(entry.path())?;
                    if !meta.is_dir() && !meta.file_type().is_symlink() {
                        continue;
                    }
                    if validate_skill_name(&name).is_err() {
                        continue;
                    }

                    let cat_dir = if catalog_skills.contains(&name) {
                        Some(get_catalog_skill_dir(&name))
                    } else {
                        None
                    };

                    let placement =
                        inspect_skill_placement(root, target, &name, cat_dir.as_deref());

                    let status = skill_map
                        .entry(name.clone())
                        .or_insert_with(|| SkillStatus {
                            name: name.clone(),
                            enabled: false,
                            targets: Vec::new(),
                            source: if catalog_skills.contains(&name) {
                                "catalog".to_string()
                            } else {
                                "inline".to_string()
                            },
                            placement: HashMap::new(),
                        });

                    if placement.state != SkillPlacementState::Missing
                        && placement.state != SkillPlacementState::BrokenLink
                    {
                        status.enabled = true;
                        if !status.targets.contains(&target) {
                            status.targets.push(target);
                        }
                    }
                    status.placement.insert(target, placement.state);
                }
            }
        }

        // Fill missing placement for catalog skills not present in this target
        for status in skill_map.values_mut() {
            status
                .placement
                .entry(target)
                .or_insert(SkillPlacementState::Missing);
        }
    }

    let mut skills: Vec<_> = skill_map.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    let enabled_count = skills.iter().filter(|s| s.enabled).count();
    let total_count = skills.len();

    Ok(SkillWorkspaceStatus {
        project_root: root.display().to_string(),
        skills,
        total_count,
        enabled_count,
    })
}

/// Add a skill from catalog to targets
pub fn skill_add<P: AsRef<Path>>(
    project_root: P,
    skill_id: &str,
    targets: &[TargetName],
    placement: Option<SkillPlacementMode>,
) -> anyhow::Result<()> {
    skill_add_with_options(project_root, skill_id, targets, placement, false)
}

pub use crate::core::skill_history::{list_skill_backups, restore_skill_backup};

pub fn preview_skill_add<P: AsRef<Path>>(
    project_root: P,
    skill_id: &str,
    targets: &[TargetName],
    placement: Option<SkillPlacementMode>,
    force: bool,
) -> anyhow::Result<serde_json::Value> {
    validate_skill_name(skill_id)?;
    let root = project_root.as_ref();
    let source = get_catalog_skill_dir(skill_id);
    if !source.join("SKILL.md").is_file() {
        anyhow::bail!("Skill {skill_id} not found in catalog");
    }
    let mode = placement.unwrap_or_else(|| default_placement_mode(root));
    let mut plans = Vec::new();
    for &target in targets {
        if target == TargetName::Grok {
            let config = get_agent_mcp_config_path(root, target);
            let registered = crate::adapters::grok::is_skill_path_registered(
                &config,
                &get_catalog_skills_dir().display().to_string(),
            )?;
            let disabled = crate::adapters::grok::is_skill_disabled(&config, skill_id)?;
            plans.push(serde_json::json!({"skill": skill_id, "target": target, "path": config, "action": if registered && !disabled { "unchanged" } else { "register" }, "blocked": false}));
        } else {
            plans.push(crate::core::skill_history::preview_skill_placement(
                root, target, skill_id, &source, mode, force,
            )?);
        }
    }
    Ok(
        serde_json::json!({"resource": "skill", "operation": "add", "dryRun": true, "blocked": plans.iter().any(|p| p["blocked"] == true), "targets": plans}),
    )
}

pub fn skill_add_with_options<P: AsRef<Path>>(
    project_root: P,
    skill_id: &str,
    targets: &[TargetName],
    placement: Option<SkillPlacementMode>,
    force: bool,
) -> anyhow::Result<()> {
    let preview = preview_skill_add(&project_root, skill_id, targets, placement, force)?;
    reject_skill_conflicts(&preview)?;
    validate_skill_name(skill_id)?;

    let root = project_root.as_ref();
    let source_dir = get_catalog_skill_dir(skill_id);
    if !source_dir.exists() {
        anyhow::bail!(
            "Skill '{}' not found in catalog. Use `acm skill link` or `acm skill install` first.",
            skill_id
        );
    }

    let mode = placement.unwrap_or_else(|| default_placement_mode(root));
    crate::paths::warn_unsupported_scope(root, targets, "skills");

    for &target in targets {
        if target == TargetName::Grok {
            let grok_config = get_agent_mcp_config_path(root, TargetName::Grok);
            let catalog_skills = get_catalog_skills_dir();
            register_skill_path(&grok_config, &catalog_skills.display().to_string())?;
            set_skill_disabled(&grok_config, skill_id, false)?;
        } else {
            copy_skill_dir_to_config_with_options(
                root,
                target,
                skill_id,
                &source_dir,
                mode,
                force,
            )?;
        }
    }

    Ok(())
}

/// Remove a skill from targets
pub fn skill_remove<P: AsRef<Path>>(
    project_root: P,
    skill_name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    validate_skill_name(skill_name)?;
    let root = project_root.as_ref();

    for &target in targets {
        if target == TargetName::Grok {
            let grok_config = get_agent_mcp_config_path(root, TargetName::Grok);
            set_skill_disabled(&grok_config, skill_name, true)?;
        } else {
            crate::core::skill_history::remove_skill_placement(root, target, skill_name)?;
        }
    }

    Ok(())
}

/// Update stale skill copies from catalog to latest content (Roadmap Priority 1)
pub fn skill_update<P: AsRef<Path>>(
    project_root: P,
    skill_name_filter: Option<&str>,
    targets: &[TargetName],
    force: bool,
) -> anyhow::Result<SkillUpdateResult> {
    skill_update_with_placement(project_root, skill_name_filter, targets, force, None)
}

fn reject_skill_conflicts(preview: &serde_json::Value) -> anyhow::Result<()> {
    let conflicts: Vec<_> = preview["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|plan| plan["blocked"] == true)
        .map(|plan| {
            format!(
                "{}/{}: {}",
                plan["target"].as_str().unwrap_or("?"),
                plan["skill"].as_str().unwrap_or("?"),
                plan["conflict"].as_str().unwrap_or("conflict")
            )
        })
        .collect();
    if !conflicts.is_empty() {
        anyhow::bail!("Skill update conflicts: {}", conflicts.join("; "));
    }
    Ok(())
}

pub fn preview_skill_update<P: AsRef<Path>>(
    project_root: P,
    skill_name_filter: Option<&str>,
    targets: &[TargetName],
    force: bool,
    placement: Option<SkillPlacementMode>,
) -> anyhow::Result<serde_json::Value> {
    let root = project_root.as_ref();
    if let Some(id) = skill_name_filter {
        validate_skill_name(id)?;
        if !get_catalog_skill_dir(id).join("SKILL.md").is_file() {
            anyhow::bail!("Skill {id} not found in catalog");
        }
    }
    let mut plans = Vec::new();
    for skill in get_skill_workspace_status(root, targets)?.skills {
        if skill_name_filter.is_some_and(|id| id != skill.name)
            || !get_catalog_skill_dir(&skill.name)
                .join("SKILL.md")
                .is_file()
        {
            continue;
        }
        for &target in targets {
            let state = skill
                .placement
                .get(&target)
                .copied()
                .unwrap_or(SkillPlacementState::Missing);
            let skip = if target == TargetName::Grok && state == SkillPlacementState::Registered {
                Some("Registered catalog path is already current")
            } else if placement.is_none() && matches!(state, SkillPlacementState::Linked) {
                Some("Linked skill already references its source")
            } else if !force
                && matches!(
                    state,
                    SkillPlacementState::Missing
                        | SkillPlacementState::BrokenLink
                        | SkillPlacementState::Unlinked
                )
            {
                Some("Not an installed copy; use --force to install")
            } else {
                None
            };
            if let Some(reason) = skip {
                plans.push(serde_json::json!({"skill": skill.name, "target": target, "action": "skip", "reason": reason, "blocked": false}));
                continue;
            }
            let mode = placement.unwrap_or_else(|| {
                if matches!(
                    state,
                    SkillPlacementState::CopyCurrent | SkillPlacementState::CopyStale
                ) {
                    SkillPlacementMode::Copy
                } else {
                    default_placement_mode(root)
                }
            });
            let preview = preview_skill_add(root, &skill.name, &[target], Some(mode), force)?;
            let mut plan = preview["targets"][0].clone();
            plan["mode"] = serde_json::json!(if mode == SkillPlacementMode::Copy {
                "copy"
            } else {
                "link"
            });
            plans.push(plan);
        }
    }
    Ok(
        serde_json::json!({"resource": "skill", "operation": "update", "dryRun": true, "blocked": plans.iter().any(|p| p["blocked"] == true), "targets": plans}),
    )
}

pub fn skill_update_with_placement<P: AsRef<Path>>(
    project_root: P,
    skill_name_filter: Option<&str>,
    targets: &[TargetName],
    force: bool,
    placement: Option<SkillPlacementMode>,
) -> anyhow::Result<SkillUpdateResult> {
    let root = project_root.as_ref();
    let preview = preview_skill_update(root, skill_name_filter, targets, force, placement)?;
    reject_skill_conflicts(&preview)?;
    let mut result = SkillUpdateResult::default();
    for plan in preview["targets"]
        .as_array()
        .context("Invalid skill update plan")?
    {
        let name = plan["skill"]
            .as_str()
            .context("Missing skill in update plan")?;
        let target: TargetName = serde_json::from_value(plan["target"].clone())?;
        let action = plan["action"].as_str().unwrap_or("skip");
        let updated = action != "skip" && action != "unchanged";
        if action != "skip" {
            let mode = if plan["mode"] == "copy" {
                SkillPlacementMode::Copy
            } else {
                SkillPlacementMode::Link
            };
            if let Err(error) = skill_add_with_options(root, name, &[target], Some(mode), force) {
                anyhow::bail!(
                    "Skill update failed for {target}/{name}: {error:#}. Completed updates: {}",
                    result
                        .details
                        .iter()
                        .filter(|d| d.updated)
                        .map(|d| format!("{}/{}", d.target, d.skill_name))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
        if updated {
            result.updated_count += 1;
        } else {
            result.skipped_count += 1;
        }
        result.details.push(SkillUpdateDetail {
            skill_name: name.into(),
            target,
            updated,
            reason: plan["reason"]
                .as_str()
                .unwrap_or(if updated {
                    "Updated; previous copy retained in local backups"
                } else {
                    "Already current"
                })
                .into(),
        });
    }
    Ok(result)
}

/// Link a development directory into catalog with optional immediate distribution (Proposal 2)
pub fn skill_link<P: AsRef<Path>>(
    source_path: P,
    skill_id_override: Option<&str>,
    distribute_targets: Option<&[TargetName]>,
    allow_home: bool,
) -> anyhow::Result<String> {
    let src = source_path
        .as_ref()
        .canonicalize()
        .context("Source directory does not exist")?;
    if !src.is_dir() {
        anyhow::bail!("Source path is not a directory: {}", src.display());
    }

    let skill_id = match skill_id_override {
        Some(id) => id.to_string(),
        None => src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("skill")
            .to_string(),
    };

    validate_skill_name(&skill_id)?;

    let skill_md = src.join("SKILL.md");
    if !skill_md.exists() {
        anyhow::bail!("No SKILL.md found in {}", src.display());
    }

    let catalog_skills_dir = get_catalog_skills_dir();
    fs::create_dir_all(&catalog_skills_dir)?;

    let dest = catalog_skills_dir.join(&skill_id);
    if dest.canonicalize().ok().as_ref() == Some(&src) {
        if let Some(targets) = distribute_targets {
            let root = if allow_home {
                home_dir()
            } else {
                crate::paths::discover_project(&std::env::current_dir()?)?
            };
            skill_add(&root, &skill_id, targets, None)?;
        }
        return Ok(skill_id);
    }
    if src.starts_with(&dest) {
        anyhow::bail!("Cannot link a skill to its own descendant");
    }
    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
        if fs::symlink_metadata(&dest).is_ok_and(|m| m.file_type().is_symlink()) {
            fs::remove_file(&dest)?;
        } else {
            anyhow::bail!(
                "Skill '{}' already exists in catalog as a real directory. Remove it first.",
                skill_id
            );
        }
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(&src, &dest)?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&src, &dest)?;

    // If distribute targets are specified, immediately add to targets (Proposal 2)
    if let Some(targets) = distribute_targets {
        let root = if allow_home {
            home_dir()
        } else {
            crate::paths::discover_project(&std::env::current_dir()?)?
        };
        skill_add(&root, &skill_id, targets, None)?;
    }

    Ok(skill_id)
}

/// Unlink a skill from catalog (only removes symlink, leaves source intact)
pub fn skill_unlink(skill_id: &str) -> anyhow::Result<()> {
    validate_skill_name(skill_id)?;
    let dest = get_catalog_skill_dir(skill_id);

    if !dest.exists() && fs::symlink_metadata(&dest).is_err() {
        anyhow::bail!("Skill '{}' is not in the catalog", skill_id);
    }

    let meta = fs::symlink_metadata(&dest)?;
    if !meta.file_type().is_symlink() {
        anyhow::bail!("Skill '{}' in catalog is a real directory, not a symlink. Use `acm skill remove` instead.", skill_id);
    }

    fs::remove_file(&dest)?;
    Ok(())
}

/// Rename existing placements without replacing locally edited copies.
pub fn skill_rename<P: AsRef<Path>>(
    project_root: P,
    old_name: &str,
    new_name: &str,
    new_source_path: Option<P>,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    use crate::core::placement::{create_dir_link, remove_path};
    use crate::storage::{object_at, read_value, update_value, FileLock};
    use serde_json::json;
    validate_skill_name(old_name)?;
    validate_skill_name(new_name)?;
    let root = project_root.as_ref();
    let old_cat = get_catalog_skill_dir(old_name);
    let new_cat = get_catalog_skill_dir(new_name);
    let _lock = FileLock::acquire(&get_catalog_skills_dir().join(".rename.lock"))?;
    fs::symlink_metadata(&old_cat).context("Skill does not exist in catalog")?;
    if fs::symlink_metadata(&new_cat).is_ok() {
        anyhow::bail!("Skill {new_name} already exists in catalog");
    }
    let source = new_source_path
        .map(|p| p.as_ref().canonicalize())
        .transpose()?;
    if source
        .as_ref()
        .is_some_and(|p| !p.join("SKILL.md").is_file() || p.starts_with(&old_cat))
    {
        anyhow::bail!(
            "New source must contain SKILL.md and must be outside the old catalog directory"
        );
    }
    let meta_path = crate::paths::get_skills_metadata_path();
    read_value(&meta_path)?;
    let mut placements = Vec::new();
    let mut grok = Vec::new();
    for &target in targets {
        let old = get_skill_path(root, target, old_name);
        let new = get_skill_path(root, target, new_name);
        if fs::symlink_metadata(&new).is_ok() {
            anyhow::bail!("Destination exists: {}", new.display());
        }
        if let Ok(meta) = fs::symlink_metadata(&old) {
            placements.push((old, new, meta.file_type().is_symlink()));
        }
        if target == TargetName::Grok {
            let path = get_agent_mcp_config_path(root, target);
            if crate::adapters::grok::is_skill_path_registered(
                &path,
                &get_catalog_skills_dir().display().to_string(),
            )? {
                grok.push((
                    path.clone(),
                    crate::adapters::grok::is_skill_disabled(&path, old_name)?,
                ));
            }
        }
    }
    let mut recovery =
        crate::core::skill_history::SkillRenameState::prepare(root, old_name, new_name, targets)?;
    let staging = tempfile::tempdir_in(get_catalog_skills_dir())?;
    let backup = staging.path().join("catalog");
    fs::rename(&old_cat, &backup)?;
    let result = if let Some(source) = &source {
        create_dir_link(source, &new_cat)
    } else {
        fs::rename(&backup, &new_cat).map_err(Into::into)
    };
    if let Err(error) = result {
        fs::rename(&backup, &old_cat)?;
        return Err(error);
    }
    let mut moved = Vec::new();
    let result: anyhow::Result<()> = (|| {
        for (index, (old, new, linked)) in placements.iter().enumerate() {
            if *linked {
                let saved = staging.path().join(format!("target-{index}"));
                fs::rename(old, &saved)?;
                if let Err(error) = create_dir_link(&new_cat, new) {
                    fs::rename(&saved, old)?;
                    return Err(error);
                }
                moved.push((old.clone(), new.clone(), Some(saved)));
            } else {
                fs::rename(old, new)?;
                moved.push((old.clone(), new.clone(), None));
            }
        }
        update_value(&meta_path, |value| {
            let entries = object_at(value, "skills")?;
            if let Some(mut entry) = entries.remove(old_name) {
                if let Some(source) = &source {
                    entry["sourceUrl"] = json!(crate::paths::format_home_path(source));
                }
                entries.insert(new_name.to_owned(), entry);
            }
            Ok(())
        })?;
        for (path, disabled) in grok {
            update_value(&path, |value| {
                let table = object_at(value, "skills")?;
                let list = table
                    .entry("disabled")
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .context("Invalid Grok disabled skill list")?;
                list.retain(|v| v != old_name && v != new_name);
                if disabled {
                    list.push(json!(new_name));
                }
                Ok(())
            })?;
        }
        recovery.apply()?;
        Ok(())
    })();
    if let Err(error) = result {
        update_value(&meta_path, |value| {
            let entries = object_at(value, "skills")?;
            if let Some(entry) = entries.remove(new_name) {
                entries.insert(old_name.to_owned(), entry);
            }
            Ok(())
        })?;
        for (old, new, saved) in moved.into_iter().rev() {
            if let Some(saved) = saved {
                remove_path(&new)?;
                fs::rename(saved, old)?;
            } else {
                fs::rename(new, old)?;
            }
        }
        if source.is_some() {
            remove_path(&new_cat)?;
            fs::rename(backup, old_cat)?;
        } else {
            fs::rename(new_cat, old_cat)?;
        }
        return Err(error);
    }
    Ok(())
}
