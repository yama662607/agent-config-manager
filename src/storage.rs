//! Locked read-modify-write operations and durable same-directory replacement.
use anyhow::{bail, Context};
use fs2::FileExt;
use serde_json::{Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub struct FileLock(File);

impl FileLock {
    pub fn acquire(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Self(file)),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        bail!("Timed out waiting for {}", path.display());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

pub fn lock_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.lock", path.display()))
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let resolved = if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        path.canonicalize()?
    } else {
        path.to_path_buf()
    };
    let path = resolved.as_path();
    let parent = path.parent().context("File has no parent directory")?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file().set_permissions(meta.permissions())?;
    }
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .with_context(|| format!("Could not replace {}", path.display()))?;
    Ok(())
}

pub fn read_value(path: &Path) -> anyhow::Result<Value> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Object(Map::new())),
        Err(e) => return Err(e).with_context(|| format!("Cannot read {}", path.display())),
    };
    let value = if path.extension().is_some_and(|e| e == "toml") {
        serde_json::to_value(toml::from_str::<toml::Value>(&content).with_context(|| {
            format!("Invalid TOML in {}; file was not changed", path.display())
        })?)?
    } else {
        serde_json::from_str(&content)
            .with_context(|| format!("Invalid JSON in {}; file was not changed", path.display()))?
    };
    if !value.is_object() {
        bail!("Expected an object in {}", path.display());
    }
    Ok(value)
}

pub fn write_value(path: &Path, value: &Value) -> anyhow::Result<()> {
    let content = if path.extension().is_some_and(|e| e == "toml") {
        let mut document = if path.exists() {
            fs::read_to_string(path)?.parse::<toml_edit::DocumentMut>()?
        } else {
            toml_edit::DocumentMut::new()
        };
        let fresh = toml_edit::ser::to_document(value)?;
        let before = read_value(path)?;
        merge_table(document.as_table_mut(), fresh.as_table(), &before, value);
        document.to_string()
    } else {
        format!("{}\n", serde_json::to_string_pretty(value)?)
    };
    atomic_write(path, content.as_bytes())
}

fn merge_table(old: &mut toml_edit::Table, new: &toml_edit::Table, before: &Value, after: &Value) {
    let removed: Vec<_> = old
        .iter()
        .filter(|(key, _)| !new.contains_key(key))
        .map(|(key, _)| key.to_owned())
        .collect();
    for key in removed {
        old.remove(&key);
    }
    for (key, item) in new {
        if before.get(key) == after.get(key) {
            continue;
        }
        let new_table = item.clone().into_table().ok();
        match (old.get_mut(key), new_table.as_ref()) {
            (Some(old_item), Some(new_table)) if old_item.is_table() => {
                merge_table(
                    old_item.as_table_mut().unwrap(),
                    new_table,
                    &before[key],
                    &after[key],
                );
            }
            (Some(old_item), _) if old_item.to_string().trim() == item.to_string().trim() => {}
            _ => {
                old.insert(key, item.clone());
            }
        }
    }
}

pub fn update_value<T>(
    path: &Path,
    update: impl FnOnce(&mut Value) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let resolved = canonical_destination(path);
    let _lock = FileLock::acquire(&lock_path(&resolved))?;
    let mut value = read_value(path)?;
    let before = value.clone();
    let result = update(&mut value)?;
    if value != before {
        write_value(path, &value)?;
    }
    Ok(result)
}

pub fn object_at<'a>(
    value: &'a mut Value,
    key: &str,
) -> anyhow::Result<&'a mut Map<String, Value>> {
    let object = value
        .as_object_mut()
        .context("Expected a configuration object")?;
    object
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .with_context(|| format!("Expected an object for {key}"))
}

pub fn validate_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.starts_with('.')
        || id.chars().any(|c| c == '/' || c == '\\' || c.is_control())
    {
        bail!("Invalid resource name: {id:?}; use a single directory name");
    }
    Ok(())
}

pub fn canonical_destination(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        path.parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.join(path.file_name().unwrap_or_default()))
            .unwrap_or_else(|| path.to_path_buf())
    })
}

/// Directory locks live outside payloads, so they cannot be copied into providers or releases.
pub fn resource_lock_path(path: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let key = path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .map(|parent| parent.join(path.file_name().unwrap_or_default()))
        .unwrap_or_else(|| path.to_path_buf());
    crate::paths::get_state_dir().join("locks").join(format!(
        "{:x}.lock",
        Sha256::digest(key.to_string_lossy().as_bytes())
    ))
}
