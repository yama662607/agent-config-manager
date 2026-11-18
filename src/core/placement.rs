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
    for entry in WalkDir::new(dir_path).follow_links(true) {
        let entry = entry.ok()?;
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
            hasher.update(fs::read(&file).ok()?);
            hasher.update(b"\0");
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

    let source_dir = catalog_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| get_catalog_skill_dir(skill_id));
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

/// Prefer the stable catalog entrance only when it resolves to this source.
pub fn stable_link_target<P: AsRef<Path>>(source_dir: P, skill_id: &str) -> PathBuf {
    let state_target = home_dir().join(".acm").join("skills").join(skill_id);
    if state_target
        .canonicalize()
        .ok()
        .zip(source_dir.as_ref().canonicalize().ok())
        .is_some_and(|(a, b)| a == b)
    {
        state_target
    } else {
        source_dir.as_ref().to_path_buf()
    }
}

/// Copy or symlink a skill directory to a target config
pub fn copy_skill_dir_to_config<P: AsRef<Path>, Q: AsRef<Path>>(
    project_root: P,
    target: TargetName,
    skill_id: &str,
    source_dir: Q,
    mode: SkillPlacementMode,
) -> anyhow::Result<PathBuf> {
    copy_skill_dir_to_config_with_options(project_root, target, skill_id, source_dir, mode, false)
}

/// Place a skill while preserving local edits and retaining recoverable previous copies.
pub fn copy_skill_dir_to_config_with_options<P: AsRef<Path>, Q: AsRef<Path>>(
    project_root: P,
    target: TargetName,
    skill_id: &str,
    source_dir: Q,
    mode: SkillPlacementMode,
    force: bool,
) -> anyhow::Result<PathBuf> {
    crate::core::skill_history::deploy_skill(
        project_root.as_ref(),
        target,
        skill_id,
        source_dir.as_ref(),
        mode,
        force,
    )
}

pub fn create_dir_link(source: &Path, destination: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    std::os::unix::fs::symlink(source, destination)?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(source, destination)?;
    Ok(())
}

pub fn remove_path(path: &Path) -> anyhow::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => fs::remove_dir_all(path)?,
        Ok(_) => fs::remove_file(path)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

/// Prepare the entire payload before replacing an existing directory or link.
pub fn replace_directory(
    destination: &Path,
    prepare: impl FnOnce(&Path) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Missing destination parent"))?;
    fs::create_dir_all(parent)?;
    let _lock =
        crate::storage::FileLock::acquire(&crate::storage::resource_lock_path(destination))?;
    let staging = tempfile::tempdir_in(parent)?;
    let payload = staging.path().join("payload");
    prepare(&payload)?;
    let backup = staging.path().join("previous");
    let exists = fs::symlink_metadata(destination).is_ok();
    if exists {
        fs::rename(destination, &backup)?;
    }
    if let Err(error) = fs::rename(&payload, destination) {
        if exists {
            fs::rename(&backup, destination)?;
        }
        return Err(error.into());
    }
    Ok(())
}

pub fn copy_dir_recursive<P: AsRef<Path>, Q: AsRef<Path>>(src: P, dst: Q) -> anyhow::Result<()> {
    let src = src.as_ref();
    let dst = dst.as_ref();
    if dst.starts_with(src)
        || crate::storage::canonical_destination(dst).starts_with(src.canonicalize()?)
    {
        anyhow::bail!("Cannot copy a directory into itself");
    }
    fs::create_dir_all(dst)?;
    let entries = WalkDir::new(src)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| {
            ![".git", ".DS_Store"]
                .iter()
                .any(|name| entry.file_name() == *name)
        });
    let mut directory_permissions = Vec::new();
    for entry in entries {
        let entry = entry?;
        let target = dst.join(entry.path().strip_prefix(src)?);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
            directory_permissions.push((target, fs::metadata(entry.path())?.permissions()));
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), target)?;
        }
    }
    for (directory, permissions) in directory_permissions.into_iter().rev() {
        fs::set_permissions(directory, permissions)?;
    }
    Ok(())
}
