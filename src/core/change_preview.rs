use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

fn files(path: Option<&Path>) -> anyhow::Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    let Some(path) = path.filter(|path| path.is_dir()) else {
        return Ok(result);
    };
    for entry in walkdir::WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".git")
    {
        let entry = entry?;
        if entry.file_type().is_file() {
            let bytes = std::fs::read(entry.path())?;
            result.insert(
                entry
                    .path()
                    .strip_prefix(path)?
                    .to_string_lossy()
                    .into_owned(),
                format!("{:x}", Sha256::digest(bytes)),
            );
        }
    }
    Ok(result)
}

pub fn directory_changes(before: Option<&Path>, after: Option<&Path>) -> anyhow::Result<Value> {
    let before = files(before)?;
    let after = files(after)?;
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
        .filter(|(key, value)| before.get(*key).is_some_and(|old| old != *value))
        .map(|(key, _)| key)
        .collect();
    Ok(json!({"added":added,"modified":modified,"removed":removed}))
}
