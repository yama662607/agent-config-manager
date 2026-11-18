use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;

pub const CATALOG_VERSION: &str = "1.0";

/// Built-in agent provider families.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Claude,
    Codex,
    Antigravity,
    Grok,
    Dsh,
}

impl ProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderKind::Claude => "claude",
            ProviderKind::Codex => "codex",
            ProviderKind::Antigravity => "antigravity",
            ProviderKind::Grok => "grok",
            ProviderKind::Dsh => "dsh",
        }
    }

    pub fn short_code(&self) -> &'static str {
        match self {
            ProviderKind::Claude => "cl",
            ProviderKind::Codex => "cx",
            ProviderKind::Antigravity => "ag",
            ProviderKind::Grok => "gk",
            ProviderKind::Dsh => "ds",
        }
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for ProviderKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "claude" | "claude-code" | "c" => Ok(ProviderKind::Claude),
            "codex" | "x" => Ok(ProviderKind::Codex),
            "antigravity" | "agy" | "a" | "g" => Ok(ProviderKind::Antigravity),
            "grok" | "k" => Ok(ProviderKind::Grok),
            "dsh" | "deepseek-harness" | "d" => Ok(ProviderKind::Dsh),
            other => Err(format!(
                "Unknown provider: '{}'. Valid: claude, codex, antigravity, grok, dsh",
                other
            )),
        }
    }
}

/// Supported Agent target names (built-in providers and configured profiles).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TargetName(Cow<'static, str>);

impl TargetName {
    #[allow(non_upper_case_globals)]
    pub const Claude: Self = Self(Cow::Borrowed("claude"));
    #[allow(non_upper_case_globals)]
    pub const Codex: Self = Self(Cow::Borrowed("codex"));
    #[allow(non_upper_case_globals)]
    pub const Antigravity: Self = Self(Cow::Borrowed("antigravity"));
    #[allow(non_upper_case_globals)]
    pub const Grok: Self = Self(Cow::Borrowed("grok"));
    #[allow(non_upper_case_globals)]
    pub const Dsh: Self = Self(Cow::Borrowed("dsh"));

    pub fn builtin_all() -> &'static [TargetName] {
        &[
            TargetName::Claude,
            TargetName::Codex,
            TargetName::Antigravity,
            TargetName::Grok,
            TargetName::Dsh,
        ]
    }

    pub fn all() -> Vec<TargetName> {
        crate::paths::all_targets().unwrap_or_else(|_| Self::builtin_all().to_vec())
    }

    pub fn custom(name: impl Into<String>) -> Self {
        let normalized = name.into().trim().to_lowercase();
        match normalized.as_str() {
            "claude" => TargetName::Claude,
            "codex" => TargetName::Codex,
            "antigravity" => TargetName::Antigravity,
            "grok" => TargetName::Grok,
            "dsh" => TargetName::Dsh,
            _ => Self(Cow::Owned(normalized)),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn provider_kind(&self) -> ProviderKind {
        crate::paths::resolve_target_provider(self).unwrap_or(ProviderKind::Claude)
    }

    pub fn short_code(&self) -> Cow<'static, str> {
        match self.as_str() {
            "claude" => Cow::Borrowed("cl"),
            "codex" => Cow::Borrowed("cx"),
            "antigravity" => Cow::Borrowed("ag"),
            "grok" => Cow::Borrowed("gk"),
            "dsh" => Cow::Borrowed("ds"),
            other => Cow::Owned(other.to_string()),
        }
    }
}

impl Serialize for TargetName {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for TargetName {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(TargetName::custom(s))
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
        if let Ok(kind) = normalized.parse::<ProviderKind>() {
            return Ok(match kind {
                ProviderKind::Claude => TargetName::Claude,
                ProviderKind::Codex => TargetName::Codex,
                ProviderKind::Antigravity => TargetName::Antigravity,
                ProviderKind::Grok => TargetName::Grok,
                ProviderKind::Dsh => TargetName::Dsh,
            });
        }
        if let Some(target) = crate::paths::resolve_configured_target(&normalized)? {
            return Ok(target);
        }
        let configured = crate::paths::configured_target_names().unwrap_or_default();
        if configured.is_empty() {
            Err(format!(
                "Unknown target: '{}'. Valid: claude, codex, agy, grok, dsh",
                s.trim()
            ))
        } else {
            Err(format!(
                "Unknown target: '{}'. Valid: claude, codex, agy, grok, dsh, {}",
                s.trim(),
                configured.join(", ")
            ))
        }
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
