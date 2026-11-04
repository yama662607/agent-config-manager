use crate::types::TargetName;

/// Declarative specification of a provider's paths, formats, and capabilities.
///
/// Centralizing provider traits here ensures that adding a new `TargetName` variant
/// only requires defining its `ProviderSpec` and handling any genuinely unique
/// protocol behaviors, rather than hunting down scattered `match` arms across the codebase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderSpec {
    pub target: TargetName,
    /// Canonical lowercase identifier (e.g., `"claude"`).
    pub id: &'static str,
    /// Human-readable display name (e.g., `"Claude Code"`).
    pub display_name: &'static str,
    /// Two-letter badge code used in TUI tables (e.g., `"cl"`).
    pub short_code: &'static str,
    /// Single-character shortcut key used in TUI target toggling/selection.
    pub tui_key: char,
    /// Accepted CLI target aliases (including `id` and short flags).
    pub aliases: &'static [&'static str],
    /// Default CLI binary name when not overridden by `ACM_<TARGET>_BIN` or `provider_commands`.
    pub default_executable: &'static str,
    /// Provider CLI version against which plugin lifecycle was verified.
    pub validated_version: &'static str,

    // --- MCP Configuration ---
    /// Home-scope MCP config path relative to `~`.
    pub home_mcp_config: &'static str,
    /// Project-scope MCP config path relative to the project root.
    pub project_mcp_config: &'static str,
    /// Top-level JSON/TOML key holding MCP server definitions (`"mcpServers"` or `"mcp_servers"`).
    pub mcp_server_block: &'static str,
    /// Field name used for remote HTTP/SSE server URLs (`"url"` or `"serverUrl"`).
    pub mcp_url_field: &'static str,
    /// Whether native MCP server objects include `"type": "stdio" | "http" | "sse"`.
    pub mcp_writes_type_field: bool,
    /// Whether the native MCP config supports `"enabled": false` inline (if false, ACM stores disabled servers in a sidecar file).
    pub mcp_supports_inline_enabled: bool,
    /// Whether home-scope MCP mutations must be delegated to the provider CLI (`claude mcp ...`) because the file holds live runtime state.
    pub mcp_delegates_user_scope_to_cli: bool,
    /// Whether the provider's CLI actually reads project-scoped MCP configurations.
    pub supports_project_mcp: bool,

    // --- Skills Configuration ---
    /// Home-scope skills directory relative to `~`.
    pub home_skills_dir: &'static str,
    /// Project-scope skills directory relative to the project root.
    pub project_skills_dir: &'static str,
    /// Whether the provider's CLI actually reads project-scoped skills.
    pub supports_project_skills: bool,
    /// Whether the provider registers skill directories in its config file (`[skills] paths` / `disabled`) instead of linking individual skills in home scope.
    pub uses_config_skill_registry: bool,

    // --- Plugins Configuration ---
    /// Home-scope plugins directory relative to `~`, if the provider has a single canonical directory.
    pub home_plugins_dir: Option<&'static str>,
    /// Project-scope plugins directory relative to the project root, if supported.
    pub project_plugins_dir: Option<&'static str>,
    /// Directories relative to `~` scanned by `acm plugin discover`.
    pub discovery_plugin_dirs: &'static [&'static str],
    /// Primary relative path to the plugin manifest inside a plugin directory.
    pub plugin_manifest_path: &'static str,
    /// Candidate manifest paths checked when opening a plugin in the TUI editor.
    pub editor_manifest_candidates: &'static [&'static str],
    /// Whether native plugin installation supports project scope (without `--home`).
    pub supports_project_plugins: bool,
    /// Whether the provider CLI registers a local marketplace before installing plugins.
    pub uses_plugin_marketplace: bool,
    /// Whether the provider CLI requires a separate `plugin enable <id>` step after `plugin install`.
    pub requires_explicit_plugin_enable: bool,
}

pub const CLAUDE_SPEC: ProviderSpec = ProviderSpec {
    target: TargetName::Claude,
    id: "claude",
    display_name: "Claude Code",
    short_code: "cl",
    tui_key: 'c',
    aliases: &["claude", "claude-code", "c"],
    default_executable: "claude",
    validated_version: "2.1.261",

    home_mcp_config: ".claude.json",
    project_mcp_config: ".mcp.json",
    mcp_server_block: "mcpServers",
    mcp_url_field: "url",
    mcp_writes_type_field: true,
    mcp_supports_inline_enabled: false,
    mcp_delegates_user_scope_to_cli: true,
    supports_project_mcp: true,

    home_skills_dir: ".claude/skills",
    project_skills_dir: ".claude/skills",
    supports_project_skills: true,
    uses_config_skill_registry: false,

    home_plugins_dir: Some(".claude/plugins"),
    project_plugins_dir: Some(".claude/plugins"),
    discovery_plugin_dirs: &[".claude/plugins"],
    plugin_manifest_path: ".claude-plugin/plugin.json",
    editor_manifest_candidates: &[".claude-plugin/plugin.json"],
    supports_project_plugins: true,
    uses_plugin_marketplace: true,
    requires_explicit_plugin_enable: false,
};

pub const CODEX_SPEC: ProviderSpec = ProviderSpec {
    target: TargetName::Codex,
    id: "codex",
    display_name: "Codex",
    short_code: "cx",
    tui_key: 'x',
    aliases: &["codex", "x"],
    default_executable: "codex",
    validated_version: "0.149.0",

    home_mcp_config: ".codex/config.toml",
    project_mcp_config: ".codex/config.toml",
    mcp_server_block: "mcp_servers",
    mcp_url_field: "url",
    mcp_writes_type_field: false,
    mcp_supports_inline_enabled: true,
    mcp_delegates_user_scope_to_cli: false,
    supports_project_mcp: true,

    home_skills_dir: ".codex/skills",
    project_skills_dir: ".codex/skills",
    supports_project_skills: true,
    uses_config_skill_registry: false,

    home_plugins_dir: None,
    project_plugins_dir: None,
    discovery_plugin_dirs: &[
        ".codex/plugins/cache",
        ".codex/.tmp/plugins/plugins",
        ".codex/.tmp/bundled-marketplaces",
    ],
    plugin_manifest_path: ".codex-plugin/plugin.json",
    editor_manifest_candidates: &[".codex-plugin/plugin.json"],
    supports_project_plugins: false,
    uses_plugin_marketplace: true,
    requires_explicit_plugin_enable: false,
};

pub const ANTIGRAVITY_SPEC: ProviderSpec = ProviderSpec {
    target: TargetName::Antigravity,
    id: "antigravity",
    display_name: "Antigravity",
    short_code: "ag",
    tui_key: 'a',
    aliases: &["antigravity", "agy", "a", "g"],
    default_executable: "agy",
    validated_version: "1.1.27",

    home_mcp_config: ".gemini/config/mcp_config.json",
    project_mcp_config: ".agents/mcp_config.json",
    mcp_server_block: "mcpServers",
    mcp_url_field: "serverUrl",
    mcp_writes_type_field: false,
    mcp_supports_inline_enabled: false,
    mcp_delegates_user_scope_to_cli: false,
    supports_project_mcp: false,

    home_skills_dir: ".gemini/config/skills",
    project_skills_dir: ".agents/skills",
    supports_project_skills: false,
    uses_config_skill_registry: false,

    home_plugins_dir: Some(".gemini/config/plugins"),
    project_plugins_dir: Some(".agents/plugins"),
    discovery_plugin_dirs: &[".gemini/config/plugins"],
    plugin_manifest_path: "plugin.json",
    editor_manifest_candidates: &[".gemini-plugin/plugin.json", "plugin.json"],
    supports_project_plugins: false,
    uses_plugin_marketplace: false,
    requires_explicit_plugin_enable: true,
};

pub const GROK_SPEC: ProviderSpec = ProviderSpec {
    target: TargetName::Grok,
    id: "grok",
    display_name: "Grok",
    short_code: "gk",
    tui_key: 'g',
    aliases: &["grok", "k"],
    default_executable: "grok",
    validated_version: "1.0.5",

    home_mcp_config: ".grok/config.toml",
    project_mcp_config: ".grok/config.toml",
    mcp_server_block: "mcp_servers",
    mcp_url_field: "url",
    mcp_writes_type_field: false,
    mcp_supports_inline_enabled: true,
    mcp_delegates_user_scope_to_cli: false,
    supports_project_mcp: true,

    home_skills_dir: ".grok/skills",
    project_skills_dir: ".grok/skills",
    supports_project_skills: true,
    uses_config_skill_registry: true,

    home_plugins_dir: None,
    project_plugins_dir: None,
    discovery_plugin_dirs: &[".grok/plugins"],
    plugin_manifest_path: ".grok-plugin/plugin.json",
    editor_manifest_candidates: &[".grok-plugin/plugin.json"],
    supports_project_plugins: false,
    uses_plugin_marketplace: true,
    requires_explicit_plugin_enable: true,
};

pub const DEEPSEEK_SPEC: ProviderSpec = ProviderSpec {
    target: TargetName::DeepSeek,
    id: "deepseek",
    display_name: "DeepSeek Harness",
    short_code: "ds",
    tui_key: 's',
    aliases: &["deepseek", "dsh", "deepseek-harness", "ds", "s"],
    default_executable: "dsh",
    validated_version: "0.2.1-rc.2",

    home_mcp_config: ".dsh/cordis.patch.yml",
    project_mcp_config: ".dsh/cordis.patch.yml",
    mcp_server_block: "mcpServers",
    mcp_url_field: "url",
    mcp_writes_type_field: false,
    mcp_supports_inline_enabled: true,
    mcp_delegates_user_scope_to_cli: false,
    supports_project_mcp: true,

    home_skills_dir: ".dsh/skills",
    project_skills_dir: ".dsh/skills",
    supports_project_skills: true,
    uses_config_skill_registry: false,

    home_plugins_dir: Some(".dsh/plugins"),
    project_plugins_dir: Some(".dsh/plugins"),
    discovery_plugin_dirs: &[".dsh/plugins"],
    plugin_manifest_path: "package.json",
    editor_manifest_candidates: &["package.json"],
    supports_project_plugins: false,
    uses_plugin_marketplace: false,
    requires_explicit_plugin_enable: false,
};

pub const ALL_PROVIDER_SPECS: &[ProviderSpec] = &[
    CLAUDE_SPEC,
    CODEX_SPEC,
    ANTIGRAVITY_SPEC,
    GROK_SPEC,
    DEEPSEEK_SPEC,
];

pub const fn provider_spec(target: TargetName) -> &'static ProviderSpec {
    match target {
        TargetName::Claude => &CLAUDE_SPEC,
        TargetName::Codex => &CODEX_SPEC,
        TargetName::Antigravity => &ANTIGRAVITY_SPEC,
        TargetName::Grok => &GROK_SPEC,
        TargetName::DeepSeek => &DEEPSEEK_SPEC,
    }
}
