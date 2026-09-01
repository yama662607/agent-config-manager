use crate::paths::{get_mcps_metadata_path, get_skills_metadata_path};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillMetadataEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    #[serde(rename = "sourceType", skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
    #[serde(rename = "sourceUrl", skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(rename = "sourceRef", skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked: Option<bool>,
    #[serde(rename = "installedAt", skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(rename = "upstreamCheckedAt", skip_serializing_if = "Option::is_none")]
    pub upstream_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillsMetadataFile {
    #[serde(default)]
    pub skills: HashMap<String, SkillMetadataEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpMetadataEntry {
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(rename = "descriptionJa", skip_serializing_if = "Option::is_none")]
    pub description_ja: Option<String>,
    #[serde(rename = "descriptionEn", skip_serializing_if = "Option::is_none")]
    pub description_en: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub popularity: Option<String>,
    #[serde(rename = "sourceType", skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(rename = "addedAt", skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpsMetadataFile {
    #[serde(default)]
    pub mcps: HashMap<String, McpMetadataEntry>,
}

pub fn load_skills_metadata() -> anyhow::Result<SkillsMetadataFile> {
    let path = get_skills_metadata_path();
    if !path.exists() {
        return Ok(SkillsMetadataFile::default());
    }
    let content = fs::read_to_string(&path).context("Failed to read skills-metadata.toml")?;
    let data: SkillsMetadataFile = toml::from_str(&content).unwrap_or_default();
    Ok(data)
}

pub fn save_skills_metadata(data: &SkillsMetadataFile) -> anyhow::Result<()> {
    let path = get_skills_metadata_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let toml_str = toml::to_string_pretty(data)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, toml_str)?;
    fs::rename(temp, path)?;
    Ok(())
}

pub fn load_mcps_metadata() -> anyhow::Result<McpsMetadataFile> {
    let path = get_mcps_metadata_path();
    if !path.exists() {
        return Ok(McpsMetadataFile::default());
    }
    let content = fs::read_to_string(&path).context("Failed to read mcps-metadata.toml")?;
    let data: McpsMetadataFile = toml::from_str(&content).unwrap_or_default();
    Ok(data)
}

pub fn save_mcps_metadata(data: &McpsMetadataFile) -> anyhow::Result<()> {
    let path = get_mcps_metadata_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let toml_str = toml::to_string_pretty(data)?;
    let temp = format!("{}.tmp", path.display());
    fs::write(&temp, toml_str)?;
    fs::rename(temp, path)?;
    Ok(())
}
