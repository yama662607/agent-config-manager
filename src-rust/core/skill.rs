use crate::adapters::grok::{register_skill_path, set_skill_disabled};
use crate::catalog::catalog::list_skills;
use crate::catalog::metadata::{load_skills_metadata, save_skills_metadata};
use crate::core::placement::{copy_skill_dir_to_config, default_placement_mode, inspect_skill_placement, SkillPlacementMode};
use crate::core::validate::validate_skill_name;
use crate::paths::{get_agent_mcp_config_path, get_agent_skills_dir, get_catalog_skill_dir, get_catalog_skills_dir, get_skill_path, home_dir};
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
        let skills_dir = get_agent_skills_dir(root, target);
        if skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if validate_skill_name(&name).is_err() {
                        continue;
                    }

                    let cat_dir = if catalog_skills.contains(&name) {
                        Some(get_catalog_skill_dir(&name))
                    } else {
                        None
                    };

                    let placement = inspect_skill_placement(root, target, &name, cat_dir.as_deref());

                    let status = skill_map.entry(name.clone()).or_insert_with(|| SkillStatus {
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

                    if placement.state != SkillPlacementState::Missing && placement.state != SkillPlacementState::BrokenLink {
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
            status.placement.entry(target).or_insert(SkillPlacementState::Missing);
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
    validate_skill_name(skill_id)?;

    let root = project_root.as_ref();
    let source_dir = get_catalog_skill_dir(skill_id);
    if !source_dir.exists() {
        anyhow::bail!("Skill '{}' not found in catalog. Use `acm skill link` or `acm skill install` first.", skill_id);
    }

    let mode = placement.unwrap_or_else(|| default_placement_mode(root));

    for &target in targets {
        if target == TargetName::Grok {
            let grok_config = get_agent_mcp_config_path(root, TargetName::Grok);
            let catalog_skills = get_catalog_skills_dir();
            register_skill_path(&grok_config, &catalog_skills.display().to_string())?;
            set_skill_disabled(&grok_config, skill_id, false)?;
        } else {
            copy_skill_dir_to_config(root, target, skill_id, &source_dir, mode)?;
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
            let dest_dir = get_skill_path(root, target, skill_name);
            if dest_dir.exists() || fs::symlink_metadata(&dest_dir).is_ok() {
                if fs::symlink_metadata(&dest_dir).map_or(false, |m| m.file_type().is_symlink()) {
                    fs::remove_file(&dest_dir)?;
                } else {
                    fs::remove_dir_all(&dest_dir)?;
                }
            }
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
    let root = project_root.as_ref();
    let ws_status = get_skill_workspace_status(root, targets)?;
    let mut result = SkillUpdateResult::default();

    for skill in ws_status.skills {
        if let Some(filter) = skill_name_filter {
            if skill.name != filter {
                continue;
            }
        }

        let cat_dir = get_catalog_skill_dir(&skill.name);
        if !cat_dir.exists() {
            continue;
        }

        for &target in targets {
            let placement = skill.placement.get(&target).copied().unwrap_or(SkillPlacementState::Missing);
            match placement {
                SkillPlacementState::CopyStale => {
                    copy_skill_dir_to_config(root, target, &skill.name, &cat_dir, SkillPlacementMode::Copy)?;
                    result.updated_count += 1;
                    result.details.push(SkillUpdateDetail {
                        skill_name: skill.name.clone(),
                        target,
                        updated: true,
                        reason: "Updated stale copy to latest catalog version".to_string(),
                    });
                }
                SkillPlacementState::CopyCurrent => {
                    if force {
                        copy_skill_dir_to_config(root, target, &skill.name, &cat_dir, SkillPlacementMode::Copy)?;
                        result.updated_count += 1;
                        result.details.push(SkillUpdateDetail {
                            skill_name: skill.name.clone(),
                            target,
                            updated: true,
                            reason: "Forced update of copy".to_string(),
                        });
                    } else {
                        result.skipped_count += 1;
                        result.details.push(SkillUpdateDetail {
                            skill_name: skill.name.clone(),
                            target,
                            updated: false,
                            reason: "Already up to date (CopyCurrent)".to_string(),
                        });
                    }
                }
                SkillPlacementState::Linked | SkillPlacementState::Registered => {
                    result.skipped_count += 1;
                    result.details.push(SkillUpdateDetail {
                        skill_name: skill.name.clone(),
                        target,
                        updated: false,
                        reason: "Symlinked or registered to catalog (always in sync)".to_string(),
                    });
                }
                SkillPlacementState::Missing | SkillPlacementState::BrokenLink | SkillPlacementState::Unlinked => {
                    if force {
                        copy_skill_dir_to_config(root, target, &skill.name, &cat_dir, default_placement_mode(root))?;
                        result.updated_count += 1;
                        result.details.push(SkillUpdateDetail {
                            skill_name: skill.name.clone(),
                            target,
                            updated: true,
                            reason: "Forced install of missing skill".to_string(),
                        });
                    }
                }
            }
        }
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
    let src = source_path.as_ref().canonicalize().context("Source directory does not exist")?;
    if !src.is_dir() {
        anyhow::bail!("Source path is not a directory: {}", src.display());
    }

    let skill_id = match skill_id_override {
        Some(id) => id.to_string(),
        None => src.file_name().and_then(|n| n.to_str()).unwrap_or("skill").to_string(),
    };

    validate_skill_name(&skill_id)?;

    let skill_md = src.join("SKILL.md");
    if !skill_md.exists() {
        anyhow::bail!("No SKILL.md found in {}", src.display());
    }

    let catalog_skills_dir = get_catalog_skills_dir();
    fs::create_dir_all(&catalog_skills_dir)?;

    let dest = catalog_skills_dir.join(&skill_id);
    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
        if fs::symlink_metadata(&dest).map_or(false, |m| m.file_type().is_symlink()) {
            fs::remove_file(&dest)?;
        } else {
            anyhow::bail!("Skill '{}' already exists in catalog as a real directory. Remove it first.", skill_id);
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
            std::env::current_dir().unwrap_or_else(|_| home_dir())
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

/// Rename a skill across catalog and all provider targets (Proposal 1)
pub fn skill_rename<P: AsRef<Path>>(
    project_root: P,
    old_name: &str,
    new_name: &str,
    new_source_path: Option<P>,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    validate_skill_name(old_name)?;
    validate_skill_name(new_name)?;

    let root = project_root.as_ref();
    let old_cat_dir = get_catalog_skill_dir(old_name);
    let new_cat_dir = get_catalog_skill_dir(new_name);

    if !old_cat_dir.exists() && fs::symlink_metadata(&old_cat_dir).is_err() {
        anyhow::bail!("Skill '{}' does not exist in catalog", old_name);
    }

    if new_cat_dir.exists() || fs::symlink_metadata(&new_cat_dir).is_ok() {
        anyhow::bail!("Skill '{}' already exists in catalog", new_name);
    }

    // 1. Rename / Relink in catalog
    if let Some(new_src) = new_source_path {
        let src_path = new_src.as_ref().canonicalize()?;
        if fs::symlink_metadata(&old_cat_dir).map_or(false, |m| m.file_type().is_symlink()) {
            fs::remove_file(&old_cat_dir)?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&src_path, &new_cat_dir)?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&src_path, &new_cat_dir)?;
    } else {
        fs::rename(&old_cat_dir, &new_cat_dir)?;
    }

    // 2. Update skills-metadata.toml
    let mut meta = load_skills_metadata().unwrap_or_default();
    if let Some(entry) = meta.skills.remove(old_name) {
        meta.skills.insert(new_name.to_string(), entry);
        let _ = save_skills_metadata(&meta);
    }

    // 3. Rename/Redistribute across targets where skill was actually present
    for &target in targets {
        if target == TargetName::Grok {
            let grok_config = get_agent_mcp_config_path(root, TargetName::Grok);
            set_skill_disabled(&grok_config, old_name, true)?;
            set_skill_disabled(&grok_config, new_name, false)?;
        } else {
            let old_target_dir = get_skill_path(root, target, old_name);
            let existed = old_target_dir.exists() || fs::symlink_metadata(&old_target_dir).is_ok();
            if !existed {
                continue;
            }

            let is_linked = fs::symlink_metadata(&old_target_dir).map_or(false, |m| m.file_type().is_symlink());

            if is_linked {
                let _ = fs::remove_file(&old_target_dir);
            } else {
                let _ = fs::remove_dir_all(&old_target_dir);
            }

            let mode = if is_linked {
                SkillPlacementMode::Link
            } else {
                default_placement_mode(root)
            };
            copy_skill_dir_to_config(root, target, new_name, &new_cat_dir, mode)?;
        }
    }

    Ok(())
}
