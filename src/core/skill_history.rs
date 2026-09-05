//! Machine-local copy baselines and scoped recovery. Catalogs never carry this state.
use crate::core::placement::{
    copy_dir_recursive, create_dir_link, stable_link_target, SkillPlacementMode,
};
use crate::paths::{get_skill_path, get_state_dir};
use crate::storage::{atomic_write, resource_lock_path, validate_id, FileLock};
use crate::types::TargetName;
use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    kind: String,
    mode: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<String>,
}
type Tree = BTreeMap<String, Entry>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Scope {
    root: PathBuf,
    target: TargetName,
    skill: String,
    destination: PathBuf,
}

impl Scope {
    fn new(root: &Path, target: TargetName, skill: &str) -> anyhow::Result<Self> {
        validate_id(skill)?;
        let root = root
            .canonicalize()
            .context("Skill scope root does not exist")?;
        let mut destination = get_skill_path(&root, target, skill);
        if crate::paths::is_home_scope(&root) {
            destination = root.join(destination.strip_prefix(crate::paths::home_dir())?);
        }
        Ok(Self {
            root,
            target,
            skill: skill.to_owned(),
            destination,
        })
    }

    fn directory(&self) -> anyhow::Result<PathBuf> {
        let key = format!("{:x}", Sha256::digest(serde_json::to_vec(self)?));
        Ok(machine_state()?.join("skill-state").join(key))
    }

    fn baseline_path(&self) -> anyhow::Result<PathBuf> {
        Ok(self.directory()?.join("baseline.json"))
    }

    fn ensure_private(&self) -> anyhow::Result<PathBuf> {
        let base = machine_state()?.join("skill-state");
        private_directory(&base)?;
        let directory = self.directory()?;
        private_directory(&directory)?;
        Ok(directory)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Baseline {
    scope: Scope,
    tree: Tree,
}

#[derive(Serialize, Deserialize)]
struct Backup {
    version: u32,
    id: String,
    scope: Scope,
    created_at: String,
    operation: String,
    before: Option<Tree>,
    after: Option<Tree>,
    baseline_before: Option<Tree>,
}

fn machine_state() -> anyhow::Result<PathBuf> {
    let state = get_state_dir();
    Ok(state
        .parent()
        .context("Missing HOME directory")?
        .canonicalize()?
        .join(".acm"))
}

fn private_directory(path: &Path) -> anyhow::Result<()> {
    reject_symlink_ancestors(path)?;
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Temporary copies can contain read-only directories. Make only disposable directories
/// writable during cleanup; persistent recovery payload permissions stay untouched.
struct DisposableDirectory(tempfile::TempDir);

impl Drop for DisposableDirectory {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for entry in WalkDir::new(self.0.path())
                .follow_links(false)
                .into_iter()
                .flatten()
            {
                if entry.file_type().is_dir() {
                    if let Ok(meta) = fs::metadata(entry.path()) {
                        let _ = fs::set_permissions(
                            entry.path(),
                            fs::Permissions::from_mode(meta.permissions().mode() | 0o700),
                        );
                    }
                }
            }
        }
    }
}

impl DisposableDirectory {
    fn new(parent: &Path) -> anyhow::Result<Self> {
        Ok(Self(tempfile::tempdir_in(parent)?))
    }
    fn path(&self) -> &Path {
        self.0.path()
    }
}

/// No destructive operation follows a provider directory link outside the selected scope.
fn reject_symlink_ancestors(path: &Path) -> anyhow::Result<()> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink()) {
            // macOS's /var and /tmp aliases are above the already-canonical scope root;
            // the machine-state path is canonicalized through its existing HOME below.
            bail!(
                "Refusing a symlinked skill/history directory: {}",
                ancestor.display()
            );
        }
    }
    Ok(())
}

fn check_destination(scope: &Scope, restoring: bool) -> anyhow::Result<()> {
    // Only inspect provider ancestors beneath the canonical scope. HOME itself may be aliased.
    let relative = scope
        .destination
        .strip_prefix(&scope.root)
        .context("Skill destination is outside the selected scope")?;
    let mut path = scope.root.clone();
    for part in relative.components() {
        path.push(part);
        if path == scope.destination && !restoring {
            break;
        }
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            bail!(
                "Refusing {} through a symbolic link: {}",
                if restoring { "restore" } else { "placement" },
                path.display()
            );
        }
    }
    Ok(())
}

fn check_source(scope: &Scope, source: &Path) -> anyhow::Result<()> {
    let source = source
        .canonicalize()
        .context("Skill source does not exist")?;
    // Reject self-referential links and copies whose temporary output would be traversed.
    if source.starts_with(&scope.destination) || scope.destination.starts_with(&source) {
        bail!("Skill source and destination must be separate, non-nested directories");
    }
    Ok(())
}

#[cfg(unix)]
fn mode(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o7777
}
#[cfg(not(unix))]
fn mode(metadata: &fs::Metadata) -> u32 {
    u32::from(metadata.permissions().readonly())
}

/// Content hashes include relative paths, types and permissions, but never expose content.
fn tree(path: &Path, source: bool) -> anyhow::Result<Option<Tree>> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(_) => (),
    }
    let mut result = Tree::new();
    for entry in WalkDir::new(path)
        .follow_links(source)
        .follow_root_links(source)
        .into_iter()
        .filter_entry(|e| {
            !source || e.depth() == 0 || ![".git", ".DS_Store"].iter().any(|n| e.file_name() == *n)
        })
    {
        let entry = entry?;
        let name = entry
            .path()
            .strip_prefix(path)?
            .to_str()
            .context("Skill payload has a non-UTF-8 path")?
            .to_owned();
        let metadata = if source {
            fs::metadata(entry.path())?
        } else {
            fs::symlink_metadata(entry.path())?
        };
        let (kind, digest, link) = if metadata.file_type().is_symlink() {
            (
                "link",
                None,
                Some(
                    fs::read_link(entry.path())?
                        .to_str()
                        .context("Non-UTF-8 symlink target")?
                        .to_owned(),
                ),
            )
        } else if metadata.is_file() {
            (
                "file",
                Some(format!("{:x}", Sha256::digest(fs::read(entry.path())?))),
                None,
            )
        } else if metadata.is_dir() {
            ("directory", None, None)
        } else {
            bail!(
                "Unsupported special file in skill: {}",
                entry.path().display()
            );
        };
        result.insert(
            name,
            Entry {
                kind: kind.into(),
                mode: mode(&metadata),
                digest,
                link,
            },
        );
    }
    Ok(Some(result))
}

fn baseline(scope: &Scope) -> anyhow::Result<Option<Tree>> {
    let path = scope.baseline_path()?;
    reject_symlink_ancestors(&path)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let baseline: Baseline =
        serde_json::from_slice(&bytes).context("Invalid skill deployment baseline")?;
    if baseline.scope != *scope {
        bail!("Skill deployment baseline has a different scope");
    }
    Ok(Some(baseline.tree))
}

fn write_baseline(scope: &Scope, value: Option<&Tree>) -> anyhow::Result<()> {
    scope.ensure_private()?;
    let path = scope.baseline_path()?;
    reject_symlink_ancestors(&path)?;
    if let Some(tree) = value {
        atomic_write(
            &path,
            &serde_json::to_vec(&Baseline {
                scope: scope.clone(),
                tree: tree.clone(),
            })?,
        )?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn changes(before: Option<&Tree>, after: Option<&Tree>) -> Value {
    let empty = Tree::new();
    let before = before.unwrap_or(&empty);
    let after = after.unwrap_or(&empty);
    let added: Vec<_> = after
        .keys()
        .filter(|key| !before.contains_key(*key))
        .collect();
    let removed: Vec<_> = before
        .keys()
        .filter(|key| !after.contains_key(*key))
        .collect();
    let modified: Vec<_> = after
        .iter()
        .filter(|(key, entry)| before.get(*key).is_some_and(|old| old != *entry))
        .map(|(key, _)| key)
        .collect();
    json!({"added": added, "removed": removed, "modified": modified})
}

fn conflict(
    current: Option<&Tree>,
    deployed: Option<&Tree>,
    desired: &Tree,
) -> Option<&'static str> {
    let current = current?;
    if current == desired {
        return None;
    }
    if current.get("").is_some_and(|e| e.kind == "link") {
        return None;
    }
    match deployed {
        Some(previous) if current == previous => None,
        Some(_) => Some("Local edits differ from the last deployment; use --force to back up and replace them"),
        None => Some("Existing copy differs and has no deployment baseline; use --force to back up and replace it"),
    }
}

fn check_placement_type(current: Option<&Tree>, allow_link: bool) -> anyhow::Result<()> {
    if current.is_some_and(|v| {
        v.get("")
            .is_none_or(|entry| entry.kind != "directory" && !(allow_link && entry.kind == "link"))
    }) {
        bail!(
            "Skill destination is not a directory copy{}",
            if allow_link { " or symbolic link" } else { "" }
        );
    }
    Ok(())
}

pub fn preview_skill_placement(
    root: &Path,
    target: TargetName,
    skill: &str,
    source: &Path,
    placement: SkillPlacementMode,
    force: bool,
) -> anyhow::Result<Value> {
    let scope = Scope::new(root, target, skill)?;
    check_destination(&scope, false)?;
    check_source(&scope, source)?;
    if !source.join("SKILL.md").is_file() {
        bail!("No SKILL.md in {}", source.display());
    }
    let desired = tree(source, true)?.context("Skill source is missing")?;
    let current = tree(&scope.destination, false)?;
    check_placement_type(current.as_ref(), true)?;
    let previous = baseline(&scope)?;
    let conflict = conflict(current.as_ref(), previous.as_ref(), &desired);
    Ok(
        json!({"skill": skill, "target": target, "path": scope.destination,
        "action": if placement == SkillPlacementMode::Link { "link" } else if current.as_ref() == Some(&desired) { "unchanged" } else { "copy" },
        "changes": changes(current.as_ref(), Some(&desired)), "conflict": conflict,
        "blocked": conflict.is_some() && !force, "forced": force && conflict.is_some(),
        "backupRequired": current.as_ref().is_some_and(|v| v.get("").is_some_and(|e| e.kind == "directory")) && (placement == SkillPlacementMode::Link || current.as_ref() != Some(&desired)),
        "baselineKnown": previous.is_some(), "baselineWillBeRecorded": placement == SkillPlacementMode::Copy && previous.as_ref() != Some(&desired)}),
    )
}

/// Removal participates in the same lock as deployment and restoration.
pub fn remove_skill_placement(root: &Path, target: TargetName, skill: &str) -> anyhow::Result<()> {
    let scope = Scope::new(root, target, skill)?;
    check_destination(&scope, false)?;
    let _lock = FileLock::acquire(&resource_lock_path(&scope.destination))?;
    check_destination(&scope, false)?;
    crate::core::placement::remove_path(&scope.destination)
}

struct RenamedScope {
    old: PathBuf,
    new: PathBuf,
    staged: DisposableDirectory,
}

/// Hold both old and new placement locks until the catalog/provider rename finishes.
pub struct SkillRenameState {
    _locks: Vec<FileLock>,
    migrations: Vec<RenamedScope>,
}

impl SkillRenameState {
    pub fn prepare(
        root: &Path,
        old_id: &str,
        new_id: &str,
        targets: &[TargetName],
    ) -> anyhow::Result<Self> {
        let scopes: Vec<_> = targets
            .iter()
            .map(|&target| {
                Ok((
                    Scope::new(root, target, old_id)?,
                    Scope::new(root, target, new_id)?,
                ))
            })
            .collect::<anyhow::Result<_>>()?;
        let mut paths = Vec::new();
        for (old, new) in &scopes {
            check_destination(old, false)?;
            check_destination(new, false)?;
            paths.extend([
                resource_lock_path(&old.destination),
                resource_lock_path(&new.destination),
            ]);
        }
        paths.sort();
        paths.dedup();
        let locks = paths
            .iter()
            .map(|path| FileLock::acquire(path))
            .collect::<anyhow::Result<_>>()?;
        let mut migrations = Vec::new();
        for (old, new) in scopes {
            let old_directory = old.directory()?;
            let new_directory = new.directory()?;
            reject_symlink_ancestors(&old_directory)?;
            reject_symlink_ancestors(&new_directory)?;
            if new_directory.exists() {
                bail!(
                    "Recovery history already exists for {new_id}/{}; choose an unused skill name",
                    new.target
                );
            }
            if !old_directory.exists() {
                continue;
            }
            // Validate source state before copying it; malformed recovery data stays untouched.
            baseline(&old)?;
            let staged = DisposableDirectory::new(
                old_directory
                    .parent()
                    .context("Missing skill state parent")?,
            )?;
            private_directory(staged.path())?;
            let payload = staged.path().join("payload");
            copy_exact(&old_directory, &payload)?;
            let baseline_path = payload.join("baseline.json");
            if baseline_path.exists() {
                let mut baseline: Baseline = serde_json::from_slice(&fs::read(&baseline_path)?)?;
                baseline.scope = new.clone();
                atomic_write(&baseline_path, &serde_json::to_vec(&baseline)?)?;
            }
            if old_directory.join("backups").exists() {
                for entry in fs::read_dir(old_directory.join("backups"))? {
                    let entry = entry?;
                    let id = entry
                        .file_name()
                        .to_str()
                        .context("Invalid recovery ID")?
                        .to_owned();
                    if !id.starts_with("backup-") {
                        continue;
                    }
                    let mut backup = read_backup(&old, &id)?;
                    backup.scope = new.clone();
                    atomic_write(
                        &payload.join("backups").join(id).join("manifest.json"),
                        &serde_json::to_vec(&backup)?,
                    )?;
                }
            }
            migrations.push(RenamedScope {
                old: old_directory,
                new: new_directory,
                staged,
            });
        }
        Ok(Self {
            _locks: locks,
            migrations,
        })
    }

    pub fn apply(&mut self) -> anyhow::Result<()> {
        let mut completed: Vec<usize> = Vec::new();
        for (index, migration) in self.migrations.iter().enumerate() {
            let saved = migration.staged.path().join("previous");
            let result = (|| {
                fs::rename(&migration.old, &saved)?;
                if let Err(error) =
                    fs::rename(migration.staged.path().join("payload"), &migration.new)
                {
                    fs::rename(&saved, &migration.old)?;
                    return Err(error);
                }
                Ok(())
            })();
            if let Err(error) = result {
                for index in completed.into_iter().rev() {
                    let previous = &self.migrations[index];
                    fs::rename(&previous.new, previous.staged.path().join("payload"))?;
                    fs::rename(previous.staged.path().join("previous"), &previous.old)?;
                }
                return Err(error.into());
            }
            completed.push(index);
        }
        Ok(())
    }
}

/// Copy backups exactly, including hidden files, empty directories, links and permissions.
fn copy_exact(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let mut directories = Vec::new();
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let to = destination.join(entry.path().strip_prefix(source)?);
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            let link = fs::read_link(entry.path())?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(link, to)?;
            #[cfg(windows)]
            if fs::metadata(entry.path()).is_ok_and(|m| m.is_dir()) {
                std::os::windows::fs::symlink_dir(link, to)?;
            } else {
                std::os::windows::fs::symlink_file(link, to)?;
            }
        } else if metadata.is_dir() {
            fs::create_dir_all(&to)?;
            directories.push((to, metadata.permissions()));
        } else if metadata.is_file() {
            fs::copy(entry.path(), to)?;
        } else {
            bail!("Cannot back up special file: {}", entry.path().display());
        }
    }
    for (path, permissions) in directories.into_iter().rev() {
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn save_backup(
    scope: &Scope,
    operation: &str,
    before: Option<&Tree>,
    after: Option<&Tree>,
    previous: Option<&Tree>,
) -> anyhow::Result<String> {
    let parent = scope.ensure_private()?.join("backups");
    private_directory(&parent)?;
    let stage = tempfile::Builder::new()
        .prefix("pending-")
        .tempdir_in(&parent)?;
    private_directory(stage.path())?;
    if before.is_some() {
        copy_exact(&scope.destination, &stage.path().join("payload"))?;
        if tree(&stage.path().join("payload"), false)?.as_ref() != before {
            bail!("Skill changed while it was being backed up; retry the operation");
        }
    }
    let id = stage
        .path()
        .file_name()
        .context("Missing backup directory name")?
        .to_str()
        .context("Invalid backup ID")?
        .replacen("pending-", "backup-", 1);
    let manifest = Backup {
        version: 1,
        id: id.clone(),
        scope: scope.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        operation: operation.into(),
        before: before.cloned(),
        after: after.cloned(),
        baseline_before: previous.cloned(),
    };
    atomic_write(
        &stage.path().join("manifest.json"),
        &serde_json::to_vec(&manifest)?,
    )?;
    // The enclosing directory is private even when payload permissions are public/executable.
    fs::rename(stage.path(), parent.join(&id))?;
    Ok(id)
}

/// Swap a fully prepared payload, rolling the directory back if baseline persistence fails.
fn commit_payload(
    scope: &Scope,
    payload: Option<&Path>,
    expected: Option<&Tree>,
    next_baseline: Option<&Tree>,
) -> anyhow::Result<()> {
    if tree(&scope.destination, false)?.as_ref() != expected {
        bail!("Skill changed during preparation; no replacement was made");
    }
    let parent = scope.destination.parent().context("Missing skill parent")?;
    let staging = DisposableDirectory::new(parent)?;
    let old = staging.path().join("previous");
    if expected.is_some() {
        fs::rename(&scope.destination, &old)?;
    }
    let outcome = (|| {
        if let Some(payload) = payload {
            fs::rename(payload, &scope.destination)?;
        }
        write_baseline(scope, next_baseline)
    })();
    if let Err(error) = outcome {
        crate::core::placement::remove_path(&scope.destination)?;
        if expected.is_some() {
            fs::rename(&old, &scope.destination)?;
        }
        return Err(error);
    }
    Ok(())
}

pub fn deploy_skill(
    root: &Path,
    target: TargetName,
    skill: &str,
    source: &Path,
    placement: SkillPlacementMode,
    force: bool,
) -> anyhow::Result<PathBuf> {
    let scope = Scope::new(root, target, skill)?;
    check_destination(&scope, false)?;
    check_source(&scope, source)?;
    if !source.join("SKILL.md").is_file() {
        bail!("No SKILL.md in {}", source.display());
    }
    if source.canonicalize().ok() == scope.destination.canonicalize().ok()
        && fs::symlink_metadata(&scope.destination).is_ok_and(|m| !m.file_type().is_symlink())
    {
        bail!("Source and destination are the same directory");
    }
    let _lock = FileLock::acquire(&resource_lock_path(&scope.destination))?;
    check_destination(&scope, false)?;
    check_source(&scope, source)?;
    let desired = tree(source, true)?.context("Missing skill source")?;
    let current = tree(&scope.destination, false)?;
    let previous = baseline(&scope)?;
    check_placement_type(current.as_ref(), true)?;
    if let Some(reason) = conflict(current.as_ref(), previous.as_ref(), &desired) {
        if !force {
            bail!("Skill {skill} for {target}: {reason}");
        }
    }
    if placement == SkillPlacementMode::Copy && current.as_ref() == Some(&desired) {
        write_baseline(&scope, Some(&desired))?;
        return Ok(scope.destination);
    }
    fs::create_dir_all(scope.destination.parent().context("Missing skill parent")?)?;
    let staged = DisposableDirectory::new(scope.destination.parent().unwrap())?;
    let payload = staged.path().join("payload");
    if placement == SkillPlacementMode::Copy {
        copy_dir_recursive(source, &payload)?;
    } else {
        create_dir_link(&stable_link_target(source, skill), &payload)?;
    }
    let after = tree(&payload, false)?.context("Missing staged payload")?;
    if placement == SkillPlacementMode::Copy && after != desired {
        bail!("Skill source changed during preparation; retry the operation");
    }
    if current
        .as_ref()
        .is_some_and(|v| v.get("").is_some_and(|e| e.kind != "link"))
    {
        save_backup(
            &scope,
            "deployment",
            current.as_ref(),
            Some(&after),
            previous.as_ref(),
        )?;
    }
    commit_payload(
        &scope,
        Some(&payload),
        current.as_ref(),
        if placement == SkillPlacementMode::Copy {
            Some(&after)
        } else {
            None
        },
    )?;
    Ok(scope.destination)
}

fn read_backup(scope: &Scope, id: &str) -> anyhow::Result<Backup> {
    validate_id(id)?;
    let path = scope.directory()?.join("backups").join(id);
    reject_symlink_ancestors(&path)?;
    reject_symlink_ancestors(&path.join("manifest.json"))?;
    let value: Backup = serde_json::from_slice(
        &fs::read(path.join("manifest.json"))
            .context("Backup does not exist in this skill/project/target scope")?,
    )?;
    if value.version != 1 || value.scope != *scope || value.id != id {
        bail!("Backup scope or format does not match this skill, project and target");
    }
    if value
        .before
        .as_ref()
        .is_some_and(|v| v.get("").is_none_or(|e| e.kind != "directory"))
    {
        bail!("Only directory-copy backups can be restored");
    }
    Ok(value)
}

pub fn list_skill_backups(
    root: &Path,
    skill: &str,
    targets: &[TargetName],
) -> anyhow::Result<Value> {
    let mut backups = Vec::new();
    for &target in targets {
        let scope = Scope::new(root, target, skill)?;
        let path = scope.directory()?.join("backups");
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        for entry in entries {
            let entry = entry?;
            let id = entry
                .file_name()
                .to_str()
                .context("Invalid backup name")?
                .to_owned();
            if !id.starts_with("backup-") {
                continue;
            }
            let backup = read_backup(&scope, &id)?;
            backups.push(
                json!({"id": id, "skill": skill, "target": target, "root": scope.root,
                "createdAt": backup.created_at, "operation": backup.operation,
                "changes": changes(backup.before.as_ref(), backup.after.as_ref())}),
            );
        }
    }
    backups.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
    Ok(json!({"skill": skill, "backups": backups}))
}

pub fn restore_skill_backup(
    root: &Path,
    skill: &str,
    id: &str,
    target: TargetName,
    force: bool,
    dry_run: bool,
) -> anyhow::Result<Value> {
    let scope = Scope::new(root, target, skill)?;
    check_destination(&scope, true)?;
    // Preview never creates lock/state files. Execution repeats every check under the lock.
    let _lock = if dry_run {
        None
    } else {
        Some(FileLock::acquire(&resource_lock_path(&scope.destination))?)
    };
    check_destination(&scope, true)?;
    let backup = read_backup(&scope, id)?;
    let payload = scope.directory()?.join("backups").join(id).join("payload");
    if tree(&payload, false)? != backup.before {
        bail!("Backup payload no longer matches its integrity manifest");
    }
    let current = tree(&scope.destination, false)?;
    check_placement_type(current.as_ref(), false)?;
    let previous = baseline(&scope)?;
    let conflict = current != backup.after;
    let mut report = json!({"skill": skill, "target": target, "backupId": id, "path": scope.destination,
        "action": "restore", "dryRun": dry_run, "changes": changes(current.as_ref(), backup.before.as_ref()),
        "conflict": if conflict { Some("Destination changed since this backup was created; use --force to preserve and replace it") } else { None }, "blocked": conflict && !force});
    if dry_run {
        return Ok(report);
    }
    if conflict && !force {
        bail!("Destination changed since backup {id}; use --force to back up current edits before restoring");
    }
    fs::create_dir_all(scope.destination.parent().context("Missing skill parent")?)?;
    let staged = DisposableDirectory::new(scope.destination.parent().unwrap())?;
    let prepared = staged.path().join("payload");
    if backup.before.is_some() {
        copy_exact(&payload, &prepared)?;
        if tree(&prepared, false)? != backup.before {
            bail!("Backup changed during restoration preparation");
        }
    }
    let undo = save_backup(
        &scope,
        "restore",
        current.as_ref(),
        backup.before.as_ref(),
        previous.as_ref(),
    )?;
    commit_payload(
        &scope,
        backup.before.as_ref().map(|_| prepared.as_path()),
        current.as_ref(),
        backup.baseline_before.as_ref(),
    )?;
    report["restored"] = json!(true);
    report["undoBackupId"] = json!(undo);
    Ok(report)
}
