use crate::catalog::metadata::{load_skills_metadata, update_skill_metadata};
use crate::paths::{get_catalog_dir, get_catalog_path, get_catalog_skills_dir};
use crate::storage::{atomic_write, object_at, read_value, validate_id, write_value, FileLock};
use crate::types::{CatalogFile, McpCatalogEntry, SkillCatalogEntry, CATALOG_VERSION};
use anyhow::{bail, Context};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Default)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
}

pub fn parse_skill_frontmatter(content: &str) -> SkillFrontmatter {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return SkillFrontmatter::default();
    }
    let yaml = lines
        .take_while(|line| line.trim() != "---")
        .collect::<Vec<_>>()
        .join("\n");
    let val = serde_yaml::from_str::<serde_yaml::Value>(&yaml).unwrap_or_default();
    SkillFrontmatter {
        name: val
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned(),
        description: val
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned(),
        license: val
            .get("license")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
    }
}

fn raw_catalog() -> anyhow::Result<Value> {
    let path = get_catalog_path();
    let mut raw = if path.exists() {
        if fs::metadata(&path)?.len() > 10 * 1024 * 1024 {
            bail!("Catalog file too large");
        }
        read_value(&path)?
    } else if get_catalog_dir().join("catalog.json").exists() {
        read_value(&get_catalog_dir().join("catalog.json"))?
    } else {
        let yaml_path = ["catalog.yaml", "catalog.yml"]
            .iter()
            .map(|name| get_catalog_dir().join(name))
            .find(|p| p.exists());
        if let Some(path) = yaml_path {
            serde_json::to_value(serde_yaml::from_str::<serde_yaml::Value>(
                &fs::read_to_string(&path)?,
            )?)?
        } else {
            json!({"version": CATALOG_VERSION, "mcps": {}})
        }
    };
    let obj = raw.as_object_mut().context("Catalog must be an object")?;
    let version = obj
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or(CATALOG_VERSION);
    if version != "1.0" && version != "1.0.0" {
        bail!("Unsupported catalog version: {version}");
    }
    obj.insert("version".into(), json!(CATALOG_VERSION));
    obj.entry("mcps").or_insert_with(|| json!({}));
    for spelling in ["mcpServers", "mcp_servers"] {
        if let Some(servers) = raw.as_object_mut().unwrap().remove(spelling) {
            let servers = servers
                .as_object()
                .context("Pasted MCP block must be an object")?;
            let mcps = object_at(&mut raw, "mcps")?;
            for (name, server) in servers {
                let mut recipe = serde_json::Map::new();
                for key in ["command", "args", "cwd", "env"] {
                    if let Some(value) = server.get(key) {
                        recipe.insert(key.into(), value.clone());
                    }
                }
                if let Some(url) = server
                    .get("url")
                    .or_else(|| server.get("serverUrl"))
                    .or_else(|| server.get("httpUrl"))
                {
                    recipe.insert("url".into(), url.clone());
                    recipe.insert("transport".into(), json!("http"));
                } else {
                    recipe.insert("transport".into(), json!("stdio"));
                }
                let entry = mcps.entry(name).or_insert_with(|| json!({"id": name, "displayName": name, "description": "", "addedAt": chrono::Utc::now().to_rfc3339()}));
                entry["recipe"] = Value::Object(recipe);
            }
        }
    }
    Ok(raw)
}

fn persist_catalog(raw: &Value) -> anyhow::Result<()> {
    let mut persisted = raw.clone();
    if let Some(skills) = persisted.as_object_mut().and_then(|o| o.remove("skills")) {
        if let Some(entries) = skills.as_object() {
            for (id, entry) in entries {
                if let Some(added) = entry.get("addedAt").and_then(Value::as_str) {
                    update_skill_metadata(id, |meta| {
                        meta.as_object_mut()
                            .context("Skill metadata must be an object")?
                            .entry("installedAt")
                            .or_insert_with(|| json!(added));
                        Ok(())
                    })?;
                }
            }
        }
    }
    for legacy in ["catalog.json", "catalog.yaml", "catalog.yml"] {
        let path = get_catalog_dir().join(legacy);
        let backup = get_catalog_dir().join(format!("{legacy}.bak"));
        if path.exists() && !backup.exists() {
            atomic_write(&backup, &fs::read(&path)?)?;
        }
    }
    write_value(&get_catalog_path(), &persisted)
}

pub fn mutate_catalog<T>(
    update: impl FnOnce(&mut Value) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _lock = FileLock::acquire(&get_catalog_dir().join("catalog.lock"))?;
    let mut raw = raw_catalog()?;
    let result = update(&mut raw)?;
    persist_catalog(&raw)?;
    Ok(result)
}

pub fn init_catalog() -> anyhow::Result<()> {
    mutate_catalog(|_| Ok(()))
}

/// A read never initializes, rewrites, or silently repairs a catalog.
pub fn load_catalog() -> anyhow::Result<CatalogFile> {
    let raw = raw_catalog()?;
    let mut catalog: CatalogFile =
        serde_json::from_value(raw.clone()).context("Invalid catalog entry")?;
    let metadata = load_skills_metadata()?;
    let mut discovered = HashMap::new();
    let dir = get_catalog_skills_dir();
    if dir.exists() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            let skill_md = entry.path().join("SKILL.md");
            if !skill_md.is_file() {
                continue;
            }
            let content = fs::read_to_string(&skill_md)?;
            let frontmatter = parse_skill_frontmatter(&content);
            let meta = metadata.skills.get(&id);
            let added_at = meta
                .and_then(|m| m.installed_at.clone())
                .or_else(|| {
                    raw.get("skills")
                        .and_then(|v| v.get(&id))
                        .and_then(|v| v.get("addedAt"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| {
                    fs::metadata(&skill_md)
                        .and_then(|m| m.modified())
                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                        .unwrap_or_default()
                });
            discovered.insert(
                id.clone(),
                SkillCatalogEntry {
                    id: id.clone(),
                    display_name: if frontmatter.name.is_empty() {
                        id.clone()
                    } else {
                        frontmatter.name
                    },
                    description: frontmatter.description,
                    path: format!("skills/{id}"),
                    added_at,
                    tags: meta.map(|m| m.tags.clone()).unwrap_or_default(),
                    license: frontmatter.license,
                },
            );
        }
    }
    catalog.skills = discovered;
    Ok(catalog)
}

pub fn write_catalog_atomic(catalog: &CatalogFile) -> anyhow::Result<()> {
    mutate_catalog(|raw| {
        let current = object_at(raw, "mcps")?;
        current.retain(|id, _| catalog.mcps.contains_key(id));
        for (id, entry) in &catalog.mcps {
            let fields = serde_json::to_value(entry)?;
            let existing = current
                .entry(id)
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .context("Invalid MCP entry")?;
            existing.extend(fields.as_object().unwrap().clone());
        }
        Ok(())
    })
}

pub fn list_mcps() -> anyhow::Result<Vec<McpCatalogEntry>> {
    let mut entries: Vec<_> = load_catalog()?.mcps.into_values().collect();
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

pub fn get_mcp(id: &str) -> anyhow::Result<Option<McpCatalogEntry>> {
    Ok(load_catalog()?.mcps.get(id).cloned())
}

pub fn add_mcp(entry: McpCatalogEntry) -> anyhow::Result<()> {
    mutate_catalog(|raw| {
        let current = object_at(raw, "mcps")?
            .entry(&entry.id)
            .or_insert_with(|| json!({}));
        current
            .as_object_mut()
            .context("Invalid MCP entry")?
            .extend(serde_json::to_value(&entry)?.as_object().unwrap().clone());
        Ok(())
    })
}

pub fn remove_mcp(id: &str) -> anyhow::Result<bool> {
    mutate_catalog(|raw| Ok(object_at(raw, "mcps")?.remove(id).is_some()))
}

pub fn list_skills() -> anyhow::Result<Vec<SkillCatalogEntry>> {
    let mut entries: Vec<_> = load_catalog()?.skills.into_values().collect();
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

pub fn get_skill(id: &str) -> anyhow::Result<Option<SkillCatalogEntry>> {
    validate_id(id)?;
    Ok(load_catalog()?.skills.get(id).cloned())
}

pub fn get_skill_with_content(id: &str) -> anyhow::Result<Option<(SkillCatalogEntry, String)>> {
    get_skill(id)?
        .map(|entry| {
            Ok((
                entry,
                fs::read_to_string(get_catalog_skills_dir().join(id).join("SKILL.md"))?,
            ))
        })
        .transpose()
}

pub fn add_skill(id: &str, content: &str) -> anyhow::Result<SkillCatalogEntry> {
    validate_id(id)?;
    atomic_write(
        &get_catalog_skills_dir().join(id).join("SKILL.md"),
        content.as_bytes(),
    )?;
    update_skill_metadata(id, |meta| {
        meta.as_object_mut()
            .context("Invalid skill metadata")?
            .entry("installedAt")
            .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
        Ok(())
    })?;
    get_skill(id)?.context("Skill was not registered")
}

pub fn remove_skill(id: &str) -> anyhow::Result<bool> {
    validate_id(id)?;
    let skill_dir = get_catalog_skills_dir().join(id);
    match fs::symlink_metadata(&skill_dir) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                fs::remove_file(&skill_dir)?;
            } else {
                fs::remove_dir_all(&skill_dir)?;
            }
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
