use crate::catalog::metadata::load_skills_metadata;
use crate::paths::{get_catalog_dir, get_catalog_path, get_catalog_skills_dir};
use crate::types::{CatalogFile, McpCatalogEntry, SkillCatalogEntry};
use anyhow::Context;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::sync::OnceLock;

/// Frontmatter parsed from a SKILL.md file
#[derive(Debug, Clone, Default)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
}

static FRONTMATTER_RE: OnceLock<Regex> = OnceLock::new();

/// Parse YAML frontmatter from a SKILL.md string
pub fn parse_skill_frontmatter(content: &str) -> SkillFrontmatter {
    let re = FRONTMATTER_RE.get_or_init(|| {
        Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---(?:\r?\n(.*))?$").unwrap()
    });

    if let Some(caps) = re.captures(content) {
        let yaml_text = caps.get(1).map_or("", |m| m.as_str());
        if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(yaml_text) {
            let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let description = val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let license = val.get("license").and_then(|v| v.as_str()).map(|s| s.to_string());
            return SkillFrontmatter { name, description, license };
        }
    }

    SkillFrontmatter {
        name: "unknown".to_string(),
        description: String::new(),
        license: None,
    }
}

/// Initialize an empty catalog if not exists
pub fn init_catalog() -> anyhow::Result<()> {
    let catalog_dir = get_catalog_dir();
    let catalog_path = get_catalog_path();

    if !catalog_dir.exists() {
        fs::create_dir_all(&catalog_dir)?;
    }

    if !catalog_path.exists() {
        let empty_catalog = CatalogFile::default();
        let toml_str = toml::to_string_pretty(&empty_catalog)?;
        let temp = format!("{}.{}.tmp", catalog_path.display(), std::process::id());
        fs::write(&temp, toml_str)?;
        fs::rename(&temp, &catalog_path)?;
    }

    let skills_dir = get_catalog_skills_dir();
    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir)?;
    }

    Ok(())
}

/// Load catalog and auto-discover skills from ~/.acm/skills/
pub fn load_catalog() -> anyhow::Result<CatalogFile> {
    let catalog_path = get_catalog_path();
    if !catalog_path.exists() {
        init_catalog()?;
    }

    let content = fs::read_to_string(&catalog_path).context("Failed to read catalog.toml")?;
    let mut catalog: CatalogFile = toml::from_str(&content)
        .with_context(|| format!("Failed to parse catalog.toml at {}", catalog_path.display()))?;

    // Rebuild skills map dynamically from ~/.acm/skills/
    let skills_dir = get_catalog_skills_dir();
    let meta_file = load_skills_metadata().unwrap_or_default();

    let mut discovered_skills = HashMap::new();
    if skills_dir.exists() {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_dir = if entry.file_type().map_or(false, |ft| ft.is_symlink()) {
                    path.exists() && fs::metadata(&path).map_or(false, |m| m.is_dir())
                } else {
                    path.is_dir()
                };

                if !is_dir {
                    continue;
                }

                let skill_id = entry.file_name().to_string_lossy().to_string();
                let skill_md = path.join("SKILL.md");
                if skill_md.exists() {
                    let skill_content = fs::read_to_string(&skill_md).unwrap_or_default();
                    let fm = parse_skill_frontmatter(&skill_content);
                    let meta = meta_file.skills.get(&skill_id);

                    let entry = SkillCatalogEntry {
                        id: skill_id.clone(),
                        display_name: if !fm.name.is_empty() && fm.name != "unknown" {
                            fm.name
                        } else {
                            skill_id.clone()
                        },
                        description: fm.description,
                        path: format!("skills/{}", skill_id),
                        added_at: meta.and_then(|m| m.installed_at.clone()).unwrap_or_else(|| {
                            chrono::Utc::now().to_rfc3339()
                        }),
                        tags: meta.map(|m| m.tags.clone()).unwrap_or_default(),
                        license: fm.license,
                    };
                    discovered_skills.insert(skill_id, entry);
                }
            }
        }
    }

    catalog.skills = discovered_skills;
    Ok(catalog)
}

/// Write catalog.toml atomically (only persists mcps)
pub fn write_catalog_atomic(catalog: &CatalogFile) -> anyhow::Result<()> {
    let catalog_path = get_catalog_path();
    if let Some(parent) = catalog_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let toml_str = toml::to_string_pretty(catalog)?;
    let temp = format!("{}.{}.tmp", catalog_path.display(), std::process::id());
    fs::write(&temp, toml_str)?;
    fs::rename(&temp, &catalog_path)?;
    Ok(())
}

/// List all MCP entries from catalog
pub fn list_mcps() -> anyhow::Result<Vec<McpCatalogEntry>> {
    let catalog = load_catalog()?;
    let mut entries: Vec<_> = catalog.mcps.into_values().collect();
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

/// Get a specific MCP entry from catalog
pub fn get_mcp(id: &str) -> anyhow::Result<Option<McpCatalogEntry>> {
    let catalog = load_catalog()?;
    Ok(catalog.mcps.get(id).cloned())
}

/// Add or update an MCP entry in catalog
pub fn add_mcp(entry: McpCatalogEntry) -> anyhow::Result<()> {
    let mut catalog = load_catalog()?;
    catalog.mcps.insert(entry.id.clone(), entry);
    write_catalog_atomic(&catalog)
}

/// Remove an MCP entry from catalog
pub fn remove_mcp(id: &str) -> anyhow::Result<bool> {
    let mut catalog = load_catalog()?;
    let removed = catalog.mcps.remove(id).is_some();
    if removed {
        write_catalog_atomic(&catalog)?;
    }
    Ok(removed)
}

/// List all Skill entries from catalog
pub fn list_skills() -> anyhow::Result<Vec<SkillCatalogEntry>> {
    let catalog = load_catalog()?;
    let mut entries: Vec<_> = catalog.skills.into_values().collect();
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

/// Get a specific Skill entry from catalog
pub fn get_skill(id: &str) -> anyhow::Result<Option<SkillCatalogEntry>> {
    let catalog = load_catalog()?;
    Ok(catalog.skills.get(id).cloned())
}

/// Get Skill entry and full SKILL.md content
pub fn get_skill_with_content(id: &str) -> anyhow::Result<Option<(SkillCatalogEntry, String)>> {
    if let Some(entry) = get_skill(id)? {
        let skill_md = get_catalog_skills_dir().join(id).join("SKILL.md");
        if skill_md.exists() {
            let content = fs::read_to_string(skill_md)?;
            return Ok(Some((entry, content)));
        }
    }
    Ok(None)
}

/// Add a skill to catalog (creates ~/.acm/skills/<id>/SKILL.md)
pub fn add_skill(id: &str, content: &str) -> anyhow::Result<SkillCatalogEntry> {
    let skill_dir = get_catalog_skills_dir().join(id);
    fs::create_dir_all(&skill_dir)?;

    let skill_md = skill_dir.join("SKILL.md");
    let temp = format!("{}.{}.tmp", skill_md.display(), std::process::id());
    fs::write(&temp, content)?;
    fs::rename(&temp, &skill_md)?;

    let fm = parse_skill_frontmatter(content);
    let entry = SkillCatalogEntry {
        id: id.to_string(),
        display_name: if !fm.name.is_empty() && fm.name != "unknown" {
            fm.name
        } else {
            id.to_string()
        },
        description: fm.description,
        path: format!("skills/{}", id),
        added_at: chrono::Utc::now().to_rfc3339(),
        tags: Vec::new(),
        license: fm.license,
    };

    Ok(entry)
}

/// Remove a skill from catalog (deletes ~/.acm/skills/<id>)
pub fn remove_skill(id: &str) -> anyhow::Result<bool> {
    let skill_dir = get_catalog_skills_dir().join(id);
    if !skill_dir.exists() && fs::symlink_metadata(&skill_dir).is_err() {
        return Ok(false);
    }

    if let Ok(meta) = fs::symlink_metadata(&skill_dir) {
        if meta.file_type().is_symlink() {
            fs::remove_file(&skill_dir)?;
        } else {
            fs::remove_dir_all(&skill_dir)?;
        }
        Ok(true)
    } else {
        Ok(false)
    }
}
