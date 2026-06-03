// ============================================================================
// Core Types
// ============================================================================

/** Supported agent targets */
export type TargetName = 'claude' | 'codex' | 'antigravity';

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
}

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
