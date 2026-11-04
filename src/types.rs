use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

pub const CATALOG_VERSION: &str = "1.0";

/// Supported Agent target names
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetName {
    Claude,
    Codex,
    Antigravity,
    Grok,
    DeepSeek,
}

impl TargetName {
    pub const fn all() -> &'static [TargetName] {
        &[
            TargetName::Claude,
            TargetName::Codex,
            TargetName::Antigravity,
            TargetName::Grok,
            TargetName::DeepSeek,
        ]
    }

    pub const fn spec(&self) -> &'static crate::providers::ProviderSpec {
        crate::providers::provider_spec(*self)
    }

    pub const fn as_str(&self) -> &'static str {
        self.spec().id
    }

    pub const fn display_name(&self) -> &'static str {
        self.spec().display_name
    }

    pub const fn short_code(&self) -> &'static str {
        self.spec().short_code
    }

    pub const fn tui_key(&self) -> char {
        self.spec().tui_key
    }

    pub fn from_tui_key(key: char) -> Option<TargetName> {
        Self::all().iter().copied().find(|t| t.tui_key() == key)
    }
}

impl fmt::Display for TargetName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for TargetName {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let normalized = s.trim().to_lowercase();
        for &target in Self::all() {
            if target.spec().aliases.contains(&normalized.as_str()) {
                return Ok(target);
            }
        }
        Err(format!(
            "Unknown target: '{}'. Valid: claude, codex, agy, grok",
            normalized
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportType {
    Stdio,
    Http,
    Sse,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct McpRecipe {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<TransportType>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpCatalogEntry {
    pub id: String,
    #[serde(rename = "displayName", default)]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub recipe: McpRecipe,
    #[serde(rename = "addedAt", default)]
    pub added_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillCatalogEntry {
    pub id: String,
    #[serde(rename = "displayName", default)]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub path: String,
    #[serde(rename = "addedAt", default)]
    pub added_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogFile {
    #[serde(rename = "$schema", default = "default_schema")]
    pub schema: String,
    #[serde(default = "catalog_version")]
    pub version: String,
    #[serde(default)]
    pub mcps: HashMap<String, McpCatalogEntry>,
    #[serde(default, skip_serializing)]
    pub skills: HashMap<String, SkillCatalogEntry>,
}

fn default_schema() -> String {
    "./catalog-schema.json".to_string()
}

fn catalog_version() -> String {
    CATALOG_VERSION.to_owned()
}

impl Default for CatalogFile {
    fn default() -> Self {
        Self {
            schema: default_schema(),
            version: CATALOG_VERSION.to_string(),
            mcps: HashMap::new(),
            skills: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillPlacementState {
    Linked,
    Registered,
    CopyCurrent,
    CopyStale,
    BrokenLink,
    Unlinked,
    Missing,
}

impl SkillPlacementState {
    pub fn label(&self) -> &'static str {
        match self {
            SkillPlacementState::Linked => "link",
            SkillPlacementState::Registered => "catalog",
            SkillPlacementState::CopyCurrent => "copy",
            SkillPlacementState::CopyStale => "stale",
            SkillPlacementState::BrokenLink => "broken",
            SkillPlacementState::Unlinked => "unlinked",
            SkillPlacementState::Missing => "-",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillPlacement {
    pub state: SkillPlacementState,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillStatus {
    pub name: String,
    pub enabled: bool,
    pub targets: Vec<TargetName>,
    pub source: String,
    pub placement: HashMap<TargetName, SkillPlacementState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWorkspaceStatus {
    pub project_root: String,
    pub skills: Vec<SkillStatus>,
    pub total_count: usize,
    pub enabled_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpStatus {
    pub name: String,
    pub enabled: bool,
    pub targets: Vec<TargetName>,
    pub recipe: McpRecipe,
    pub source: String,
    pub state: HashMap<TargetName, String>,
    pub deployed: HashMap<TargetName, McpRecipe>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<McpRecipe>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWorkspaceStatus {
    pub project_root: String,
    pub servers: Vec<McpStatus>,
    pub total_count: usize,
    pub enabled_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Error,
    Warning,
}

/// Plugin placement state for each agent target
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginPlacementState {
    Disabled,
    Missing,
    NativeLinked,
    ConvertedLinked,
    Injected,
    Broken,
}

/// Information about a plugin in the catalog or installed in a workspace
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub enabled: bool,
    pub targets: Vec<TargetName>,
    pub placement: HashMap<TargetName, PluginPlacementState>,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginWorkspaceStatus {
    pub project_root: String,
    pub plugins: Vec<PluginStatus>,
    pub total_count: usize,
    pub enabled_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginUpdateResult {
    pub id: String,
    pub updated: bool,
    pub message: String,
    pub reprojected_targets: Vec<TargetName>,
}
