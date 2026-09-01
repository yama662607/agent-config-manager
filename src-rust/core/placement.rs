use crate::paths::{get_catalog_skill_dir, get_skill_path, home_dir, is_home_scope};
use crate::types::{SkillPlacement, SkillPlacementState, TargetName};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillPlacementMode {
    Link,
    Copy,
}

pub fn default_placement_mode<P: AsRef<Path>>(project_root: P) -> SkillPlacementMode {
    if is_home_scope(project_root) {
        SkillPlacementMode::Link
    } else {
        SkillPlacementMode::Copy
    }
}

/// Compute SHA256 digest of a skill directory
pub fn digest_skill_dir<P: AsRef<Path>>(dir: P) -> Option<String> {
    let dir_path = dir.as_ref();
    if !dir_path.exists() || !dir_path.is_dir() {
        return None;
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(dir_path).follow_links(true).into_iter().flatten() {
        if entry.file_type().is_file() {
            files.push(entry.into_path());
        }
    }
    files.sort();

    let mut hasher = Sha256::new();
    for file in files {
        if let Ok(rel_path) = file.strip_prefix(dir_path) {
            hasher.update(rel_path.to_string_lossy().as_bytes());
            hasher.update(b"\0");
            if let Ok(content) = fs::read(&file) {
                hasher.update(&content);
                hasher.update(b"\0");
            }
        }
    }

    Some(format!("{:x}", hasher.finalize()))
}

/// Inspect placement state of a skill in a target
pub fn inspect_skill_placement<P: AsRef<Path>>(
    project_root: P,
    target: TargetName,
    skill_id: &str,
    catalog_dir: Option<&Path>,
) -> SkillPlacement {
    let skill_path = get_skill_path(project_root, target, skill_id);

    let meta = match fs::symlink_metadata(&skill_path) {
        Ok(m) => m,
        Err(_) => {
            return SkillPlacement {
                state: SkillPlacementState::Missing,
                path: skill_path.display().to_string(),
                link_target: None,
                digest: None,
                source_digest: None,
            };
        }
    };

    if meta.file_type().is_symlink() {
        let link_target = fs::read_link(&skill_path)
            .ok()
            .map(|p| p.display().to_string());
        let is_broken = fs::metadata(&skill_path).is_err();

        return SkillPlacement {
            state: if is_broken {
                SkillPlacementState::BrokenLink
            } else {
                SkillPlacementState::Linked
            },
            path: skill_path.display().to_string(),
            link_target,
            digest: None,
            source_digest: None,
        };
    }

    let dest_digest = digest_skill_dir(&skill_path);

    let source_dir = catalog_dir.map(PathBuf::from).unwrap_or_else(|| get_catalog_skill_dir(skill_id));
    let source_digest = if source_dir.exists() {
        digest_skill_dir(&source_dir)
    } else {
        None
    };

    let state = match (&dest_digest, &source_digest) {
        (Some(d1), Some(d2)) if d1 == d2 => SkillPlacementState::CopyCurrent,
        (Some(_), Some(_)) => SkillPlacementState::CopyStale,
        _ => SkillPlacementState::Unlinked,
    };

    SkillPlacement {
        state,
        path: skill_path.display().to_string(),
        link_target: None,
        digest: dest_digest,
        source_digest,
    }
}

/// Ensure ~/.acm/skills is accessible
fn ensure_state_entrance() -> anyhow::Result<()> {
    let state_skills = home_dir().join(".acm").join("skills");
    if !state_skills.exists() {
        fs::create_dir_all(&state_skills)?;
    }
    Ok(())
}

/// Resolve stable symlink target
pub fn stable_link_target<P: AsRef<Path>>(source_dir: P, skill_id: &str) -> PathBuf {
    let _ = ensure_state_entrance();
    let state_target = home_dir().join(".acm").join("skills").join(skill_id);
    if state_target.exists() {
        state_target
    } else {
        source_dir.as_ref().to_path_buf()
    }
}

/// Copy or symlink a skill directory to a target config
pub fn copy_skill_dir_to_config<P: AsRef<Path>>(
    project_root: P,
    target: TargetName,
    skill_id: &str,
    source_dir: P,
    mode: SkillPlacementMode,
) -> anyhow::Result<PathBuf> {
    let dest_dir = get_skill_path(project_root, target, skill_id);

    if let Some(parent) = dest_dir.parent() {
        fs::create_dir_all(parent)?;
    }

    if dest_dir.exists() || fs::symlink_metadata(&dest_dir).is_ok() {
        if fs::symlink_metadata(&dest_dir).map_or(false, |m| m.file_type().is_symlink()) {
            fs::remove_file(&dest_dir)?;
        } else {
            fs::remove_dir_all(&dest_dir)?;
        }
    }

    if mode == SkillPlacementMode::Link {
        let link_src = stable_link_target(source_dir, skill_id);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&link_src, &dest_dir)?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&link_src, &dest_dir)?;
    } else {
        copy_dir_recursive(source_dir.as_ref(), &dest_dir)?;
    }

    Ok(dest_dir)
}

/// Copy directory recursively
pub fn copy_dir_recursive<P: AsRef<Path>, Q: AsRef<Path>>(src: P, dst: Q) -> anyhow::Result<()> {
    let src_path = src.as_ref();
    let dst_path = dst.as_ref();

    fs::create_dir_all(dst_path)?;
    for entry in fs::read_dir(src_path)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst_path.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(entry.path(), target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
