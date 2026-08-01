// ============================================================================
// Core Types
// ============================================================================

/** Supported agent targets */
export type TargetName = 'claude' | 'codex' | 'antigravity' | 'grok';

/** Transport types for MCP servers */
export type TransportType = 'stdio' | 'http' | 'sse';

// ============================================================================
// Project Discovery
// ============================================================================

/** Result of project discovery */
export interface ProjectDiscovery {
  /** Absolute path to the project root */
  root: string;
  /** Discovered native config paths for each target */
  targets: Map<TargetName, NativeConfigPath>;
}

/** Native config file path for a target */
export interface NativeConfigPath {
  target: TargetName;
  /** Absolute path to the config file */
  path: string;
  /** Whether the config file exists */
  exists: boolean;
}

// ============================================================================
// Catalog Types
// ============================================================================

/** Catalog schema version */
export const CATALOG_VERSION: string = '1.0';

/** MCP server recipe */
export interface McpRecipe {
  /** Transport type: stdio (command) or http (url) */
  transport?: TransportType;
  /** Command to execute (stdio transport) */
  command?: string;
  /** Arguments for command (stdio transport) */
  args?: string[];
  /** HTTP/SSE URL (http/sse transport) */
  url?: string;
  /** Working directory for command execution */
  cwd?: string;
  /** Environment variables for command */
  env?: Record<string, string>;
}

/** MCP entry in the catalog */
export interface McpCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  recipe: McpRecipe;
  addedAt: string; // ISO 8601 timestamp
  tags?: string[];
}

/** Catalog file structure */
export interface CatalogFile {
  $schema?: string;
  version: string;
  mcps: Record<string, McpCatalogEntry>;
  skills: Record<string, SkillCatalogEntry>;
}

// ============================================================================
// Skill Types
// ============================================================================

/** Skill file content (SKILL.md) */
export interface SkillRecipe {
  /** Skill name (from YAML frontmatter) */
  name: string;
  /** Skill description (from YAML frontmatter) */
  description: string;
  /** Full skill content including YAML frontmatter and Markdown body */
  content: string;
  /** Optional license information */
  license?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Skill entry in the catalog (file-based storage) */
export interface SkillCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  /** Relative path from catalog directory (e.g., "skills/skill-creator") */
  path: string;
  addedAt: string; // ISO 8601 timestamp
  tags?: string[];
  /** Optional license from YAML frontmatter */
  license?: string;
}

// ============================================================================
// Enhanced Skill Metadata (skills-metadata.toml)
// ============================================================================

/** Result of decomposing a scanned source string into structured fields */
export interface DecomposedSource {
  /** Source type: "user", "plugin", "curated", "system", "bundled" */
  sourceType?: string;
  /** Which agent this skill belongs to: "claude", "codex", "antigravity" */
  agent?: string;
  /** Plugin name if sourced from a plugin (e.g. "vercel", "stripe") */
  plugin?: string;
}

/** Enhanced per-skill metadata stored in skills-metadata.toml */
export interface EnhancedSkillMetadata {
  /** Source type: "user", "plugin", "curated", "system", "bundled" */
  sourceType?: string;
  /** Which agent this skill belongs to */
  agent?: string;
  /** Plugin name if from a plugin */
  plugin?: string;
  /** Functional category */
  category?: string;
  /** Version string (from frontmatter or manual) */
  version?: string;
  /** Author name (from frontmatter or manual) */
  author?: string;
  /** ISO 8601 timestamp of last file modification (auto-detected) */
  updatedAt?: string;
  /** User favorite flag (manual) */
  pinned?: boolean;
  /** Deprecation flag (manual) */
  deprecated?: boolean;
  /** Flexible user-defined tags */
  tags?: string[];

  // --- Provenance: where this skill came from, so it can be revisited ---

  /** Upstream location, e.g. a GitHub tree URL. */
  sourceUrl?: string;
  /** How sourceUrl is interpreted. Only `github` supports update checks today. */
  sourceKind?: 'github' | 'local' | 'plugin' | 'unknown';
  /**
   * The exact upstream revision this copy came from — a commit SHA, not a
   * branch name. A moving ref cannot answer "has upstream changed since?".
   */
  sourceRef?: string;
  /** When this copy was taken from upstream. */
  installedAt?: string;
  /** When upstream was last compared against this copy. */
  upstreamCheckedAt?: string;
  /**
   * Deliberately modified from upstream. Update checks report it as forked
   * rather than behind, so an intentional divergence stops nagging.
   */
  forked?: boolean;
}

/** Top-level structure of skills-metadata.toml */
export interface SkillsMetadataFile {
  version: string;
  skills: Record<string, EnhancedSkillMetadata>;
}

// ============================================================================
// Enhanced MCP Metadata (mcps-metadata.toml)
// ============================================================================

/** Enhanced per-MCP metadata stored in mcps-metadata.toml */
export interface EnhancedMcpMetadata {
  /** Human-readable display name */
  displayName?: string;
  /** Japanese description */
  descriptionJa?: string;
  /** English description */
  descriptionEn?: string;
  /** Functional category */
  category?: string;
  /** Primary implementation language */
  language?: string;
  /** Transport type */
  transport?: TransportType;
  /** npm package name (if applicable) */
  package?: string;
  /** GitHub repository (owner/repo format) */
  github?: string;
  /** Official website URL */
  website?: string;
  /** Popularity tier: "high", "medium", "low" */
  popularity?: string;
  /** Source type: "config" (main config), "plugin" (plugin directory) */
  sourceType?: string;
  /** Which agent this MCP belongs to: "claude", "codex", "antigravity" */
  agent?: string;
  /** ISO 8601 timestamp of when this entry was added */
  addedAt?: string;
  /** User favorite flag (manual) */
  pinned?: boolean;
  /** Deprecation flag (manual) */
  deprecated?: boolean;
  /** Flexible user-defined tags */
  tags?: string[];
}

/** Top-level structure of mcps-metadata.toml */
export interface McpsMetadataFile {
  version: string;
  mcps: Record<string, EnhancedMcpMetadata>;
}

// ============================================================================
// Plugin Management (plugins-metadata.toml)
// ============================================================================

/** Raw plugin manifest as read from source plugin.json */
export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  interface?: {
    displayName?: string;
    category?: string;
    shortDescription?: string;
    longDescription?: string;
    developerName?: string;
    capabilities?: string[];
    websiteURL?: string;
    privacyPolicyURL?: string;
    termsOfServiceURL?: string;
    defaultPrompt?: string[];
    brandColor?: string;
    composerIcon?: string;
    logo?: string;
    screenshots?: string[];
  };
}

/** Installed plugin entry in plugins-metadata.toml */
export interface PluginEntry {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  category?: string;
  /** Display name from interface block */
  displayName?: string;
  /** Long description from interface block */
  longDescription?: string;
  /** Capabilities from interface block */
  capabilities?: string[];
  /** Default prompts from interface block */
  defaultPrompt?: string[];
  /** Brand color from interface block */
  brandColor?: string;
  /** Privacy policy URL */
  privacyPolicyURL?: string;
  /** Terms of service URL */
  termsOfServiceURL?: string;
  /** Which agent this plugin was sourced from */
  agent: TargetName;
  /** Which agents this plugin is installed for */
  installedFor?: TargetName[];
  /** Absolute path to the original plugin source directory */
  sourcePath: string;
  /** Skill IDs included in this plugin */
  skills: string[];
  /** MCP IDs included in this plugin */
  mcps: string[];
  /** Agent file names (relative to agents/) */
  agentFiles: string[];
  /** Knowledge file names (AGENTS.md, vercel.md, etc.) */
  knowledgeFiles: string[];
  /** Command file names (relative to commands/) */
  commandFiles: string[];
  /** ISO 8601 timestamp of installation */
  installedAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt?: string;
  /** User favorite flag */
  pinned?: boolean;
}

/** Result of scanning for an available plugin */
export interface PluginScanResult {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  category?: string;
  agent: TargetName;
  sourcePath: string;
  skills: number;
  mcps: number;
  agents: number;
}

/** Top-level structure of plugins-metadata.toml */
export interface PluginsMetadataFile {
  version: string;
  plugins: Record<string, PluginEntry>;
}

// ============================================================================
// Native Config Types
// ============================================================================

/** Claude Code .mcp.json structure */
export interface ClaudeMcpConfig {
  mcpServers: Record<string, ClaudeMcpServer>;
}

export interface ClaudeMcpServer {
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** Codex .codex/config.toml structure (partial) */
export interface CodexConfig {
  mcp_servers?: Record<string, CodexMcpServer>;
}

export interface CodexMcpServer {
  command?: string;
  args?: string[];
  httpUrl?: string;
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

/** Grok CLI .grok/config.toml structure (partial) */
export interface GrokConfig {
  mcp_servers?: Record<string, GrokMcpServer>;
  skills?: GrokSkillsConfig;
}

export interface GrokMcpServer {
  command?: string;
  args?: string[];
  url?: string;  // HTTP/SSE URL
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled?: boolean;
}

/** Grok [skills] section. ACM registers catalog paths here instead of copying skills. */
export interface GrokSkillsConfig {
  paths?: string[];
  ignore?: string[];
  disabled?: string[];
}

/** Antigravity CLI .agents/mcp_config.json structure (partial) */
export interface AntigravitySettings {
  mcpServers?: Record<string, AntigravityMcpServer>;
}

export interface AntigravityMcpServer {
  command?: string;
  args?: string[];
  serverUrl?: string;  // HTTP/SSE URL
  cwd?: string;
  env?: Record<string, string>;
}

// ============================================================================
// Workspace Status Types
// ============================================================================

/** Status of a single MCP server in the project */
export interface McpServerStatus {
  name: string;
  enabled: boolean;
  targets: TargetName[];
  source: 'catalog' | 'inline';
}

/** Overall MCP status for the project */
export interface McpWorkspaceStatus {
  projectRoot: string;
  servers: McpServerStatus[];
  totalCount: number;
  enabledCount: number;
}

/** Status of a single skill in the project */
export interface SkillStatus {
  name: string;
  enabled: boolean;
  targets: TargetName[];
  source: 'catalog' | 'inline';
  /** How the skill is placed per target (symlink, fresh copy, stale copy, ...) */
  placement?: Partial<Record<TargetName, SkillPlacementState>>;
}

/** How an installed skill relates to its catalog source (see skill-placement.ts) */
export type SkillPlacementState =
  | 'linked'
  /** Grok only: read straight from a registered catalog path, never copied. */
  | 'registered'
  | 'copy-current'
  | 'copy-stale'
  | 'broken-link'
  | 'unlinked'
  | 'missing';

/** Overall skill status for the project */
export interface SkillWorkspaceStatus {
  projectRoot: string;
  skills: SkillStatus[];
  totalCount: number;
  enabledCount: number;
}

// ============================================================================
// Config Adapter Types
// ============================================================================

/** Result of reading a native config */
export interface ConfigReadResult<T> {
  /** Parsed config object */
  config: T | null;
  /** Whether the file exists */
  exists: boolean;
  /** Raw content if parsing failed */
  raw?: string;
}

/** Mutation operation on a native config */
export interface ConfigMutation {
  target: TargetName;
  operation: 'add' | 'remove' | 'enable' | 'disable';
  serverName: string;
  config?: McpRecipe;
}
