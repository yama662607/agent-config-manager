/**
 * Cross-Agent Scanner
 *
 * Discovers skills and MCPs across Claude Code, Codex, and Antigravity CLI.
 * Read-only: never modifies files outside ~/.acm/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TargetName, McpRecipe, DecomposedSource } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface ScannedSkill {
  id: string;
  /** Full path to the original SKILL.md */
  skillPath: string;
  /** SKILL.md content */
  content: string;
  /** Source tag, e.g. "user:claude", "plugin:codex:stripe" */
  source: string;
  /** Which agent this was found in */
  agent: TargetName;
}

export interface ScannedMcp {
  id: string;
  /** MCP recipe (command/args/env/url etc.) */
  recipe: McpRecipe;
  /** Source tag, e.g. "claude", "codex" */
  source: string;
  /** Which agent this was found in */
  agent: TargetName;
  /** Whether the MCP is enabled (for Codex entries that can be disabled) */
  enabled?: boolean;
}

interface SkillScanPath {
  /** Base directory (resolved from ~) */
  baseDir: string;
  /** How deep to look for SKILL.md */
  mode: 'direct' | 'nested' | 'nested-deep';
  /** Source tag prefix */
  sourcePrefix: string;
  /** Which agent */
  agent: TargetName;
  /** Skip directories matching these names */
  skipDirs?: string[];
}

// ============================================================================
// Source Decomposition
// ============================================================================

/**
 * Decompose a scanned source string into structured fields.
 *
 * Source format: <sourceType>:<agent>[:<plugin>...]
 * Special case: "plugin:codex-bundled" → sourceType="bundled", agent="codex"
 *
 * Examples:
 *   "user:claude"           → { sourceType: "user", agent: "claude" }
 *   "plugin:codex:vercel"   → { sourceType: "plugin", agent: "codex", plugin: "vercel" }
 *   "plugin:codex-bundled:stripe" → { sourceType: "bundled", agent: "codex", plugin: "stripe" }
 *   "system:codex"          → { sourceType: "system", agent: "codex" }
 *   "curated:codex"         → { sourceType: "curated", agent: "codex" }
 *   "user:antigravity"      → { sourceType: "user", agent: "antigravity" }
 */
export function decomposeSource(source: string): DecomposedSource {
  const parts = source.split(':');

  if (parts.length < 2) {
    return { sourceType: parts[0], agent: undefined, plugin: undefined };
  }

  let sourceType: string;
  let agent: string | undefined;
  let plugin: string | undefined;

  if (parts[0] === 'plugin' && parts[1] === 'codex-bundled') {
    // "plugin:codex-bundled" → sourceType="bundled"
    // "plugin:codex-bundled:stripe" → sourceType="bundled", plugin="stripe"
    sourceType = 'bundled';
    agent = 'codex';
    plugin = parts.length > 2 ? parts[2] : undefined;
  } else if (parts[0] === 'plugin' && parts[1] === 'claude') {
    // "plugin:claude:official" → agent="claude", plugin from last segment
    // "plugin:claude:codex:stripe" → agent="claude", plugin="stripe"
    sourceType = 'plugin';
    agent = 'claude';
    plugin = parts.length > 2 ? parts[parts.length - 1] : undefined;
  } else if (parts[0] === 'plugin') {
    // "plugin:codex:vercel" → agent="codex", plugin="vercel"
    sourceType = 'plugin';
    agent = parts[1];
    plugin = parts.length > 2 ? parts[parts.length - 1] : undefined;
  } else {
    // "user:claude", "curated:codex", "system:codex", "user:antigravity"
    sourceType = parts[0];
    agent = parts[1];
    plugin = undefined;
  }

  return { sourceType, agent, plugin };
}

// ============================================================================
// Skill Scan Path Definitions
// ============================================================================

function getHome(): string {
  return os.homedir();
}

export function getSkillScanPaths(): SkillScanPath[] {
  const home = getHome();
  return [
    // Claude Code — user skills
    {
      baseDir: path.join(home, '.claude', 'skills'),
      mode: 'direct',
      sourcePrefix: 'user:claude',
      agent: 'claude',
    },
    // Claude Code — official plugin skills
    {
      baseDir: path.join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins'),
      mode: 'nested',
      sourcePrefix: 'plugin:claude:official',
      agent: 'claude',
    },
    // Claude Code — Codex plugin skills
    {
      baseDir: path.join(home, '.claude', 'plugins', 'marketplaces', 'openai-codex', 'plugins'),
      mode: 'nested',
      sourcePrefix: 'plugin:claude:codex',
      agent: 'claude',
    },
    // Codex — user skills (skip .system)
    {
      baseDir: path.join(home, '.codex', 'skills'),
      mode: 'direct',
      sourcePrefix: 'user:codex',
      agent: 'codex',
      skipDirs: ['.system'],
    },
    // Codex — system skills
    {
      baseDir: path.join(home, '.codex', 'skills', '.system'),
      mode: 'direct',
      sourcePrefix: 'system:codex',
      agent: 'codex',
    },
    // Codex — curated skills
    {
      baseDir: path.join(home, '.codex', 'vendor_imports', 'skills', 'skills', '.curated'),
      mode: 'direct',
      sourcePrefix: 'curated:codex',
      agent: 'codex',
    },
    // Codex — plugin skills
    {
      baseDir: path.join(home, '.codex', '.tmp', 'plugins', 'plugins'),
      mode: 'nested',
      sourcePrefix: 'plugin:codex',
      agent: 'codex',
    },
    // Codex — bundled marketplace skills
    {
      baseDir: path.join(home, '.codex', '.tmp', 'bundled-marketplaces'),
      mode: 'nested-deep',
      sourcePrefix: 'plugin:codex-bundled',
      agent: 'codex',
    },
    // Antigravity — user skills
    {
      baseDir: path.join(home, '.agents', 'skills'),
      mode: 'direct',
      sourcePrefix: 'user:antigravity',
      agent: 'antigravity',
    },
    // Antigravity — plugin skills
    {
      baseDir: path.join(home, '.gemini', 'config', 'plugins'),
      mode: 'nested',
      sourcePrefix: 'plugin:antigravity',
      agent: 'antigravity',
    },
  ];
}

// ============================================================================
// Skill Scanning
// ============================================================================

/**
 * Scan all agents for skills.
 * Returns a deduplicated list of discovered skills.
 */
export async function scanAllSkills(): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];
  const seenIds = new Set<string>();
  const paths = getSkillScanPaths();

  for (const scanPath of paths) {
    const discovered = await scanSkillPath(scanPath);
    for (const skill of discovered) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        results.push(skill);
      }
    }
  }

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

async function scanSkillPath(scanPath: SkillScanPath): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];

  try {
    await fs.access(scanPath.baseDir);
  } catch {
    return results; // Directory doesn't exist, skip
  }

  if (scanPath.mode === 'direct') {
    return scanDirectPath(scanPath);
  } else if (scanPath.mode === 'nested') {
    return scanNestedPath(scanPath);
  } else if (scanPath.mode === 'nested-deep') {
    return scanNestedDeepPath(scanPath);
  }

  return results;
}

/**
 * Direct mode: baseDir/<id>/SKILL.md
 */
async function scanDirectPath(scanPath: SkillScanPath): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];

  let entries;
  try {
    entries = await fs.readdir(scanPath.baseDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Skip hidden dirs and excluded dirs
    if (entry.name.startsWith('.') && entry.name !== '.system') continue;
    if (scanPath.skipDirs?.includes(entry.name)) continue;

    const skillId = entry.name;
    const skillFilePath = path.join(scanPath.baseDir, skillId, 'SKILL.md');

    try {
      const content = await fs.readFile(skillFilePath, 'utf8');
      results.push({
        id: skillId,
        skillPath: skillFilePath,
        content,
        source: scanPath.sourcePrefix,
        agent: scanPath.agent,
      });
    } catch {
      // SKILL.md doesn't exist or not readable, skip
    }
  }

  return results;
}

/**
 * Nested mode: baseDir/<plugin>/skills/<id>/SKILL.md
 */
async function scanNestedPath(scanPath: SkillScanPath): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];

  let pluginEntries;
  try {
    pluginEntries = await fs.readdir(scanPath.baseDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue;
    if (pluginEntry.name.startsWith('.')) continue;

    const skillsDir = path.join(scanPath.baseDir, pluginEntry.name, 'skills');

    let skillEntries;
    try {
      skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
    } catch {
      continue; // No skills/ subdir in this plugin
    }

    for (const skillEntry of skillEntries) {
      if (!skillEntry.isDirectory()) continue;
      if (skillEntry.name.startsWith('.')) continue;

      const skillFilePath = path.join(skillsDir, skillEntry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillFilePath, 'utf8');
        results.push({
          id: skillEntry.name,
          skillPath: skillFilePath,
          content,
          source: `${scanPath.sourcePrefix}:${pluginEntry.name}`,
          agent: scanPath.agent,
        });
      } catch {
        // SKILL.md doesn't exist, skip
      }
    }
  }

  return results;
}

/**
 * Nested-deep mode: baseDir/<marketplace>/plugins/<plugin>/skills/<id>/SKILL.md
 * Used for Codex bundled marketplaces.
 */
async function scanNestedDeepPath(scanPath: SkillScanPath): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];

  let marketplaceEntries;
  try {
    marketplaceEntries = await fs.readdir(scanPath.baseDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const marketEntry of marketplaceEntries) {
    if (!marketEntry.isDirectory()) continue;
    if (marketEntry.name.startsWith('.')) continue;

    const pluginsDir = path.join(scanPath.baseDir, marketEntry.name, 'plugins');

    let pluginEntries;
    try {
      pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const pluginEntry of pluginEntries) {
      if (!pluginEntry.isDirectory()) continue;

      const skillsDir = path.join(pluginsDir, pluginEntry.name, 'skills');

      let skillEntries;
      try {
        skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory()) continue;

        const skillFilePath = path.join(skillsDir, skillEntry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillFilePath, 'utf8');
          results.push({
            id: skillEntry.name,
            skillPath: skillFilePath,
            content,
            source: `${scanPath.sourcePrefix}:${pluginEntry.name}`,
            agent: scanPath.agent,
          });
        } catch {
          // SKILL.md doesn't exist, skip
        }
      }
    }
  }

  return results;
}

// ============================================================================
// MCP Scanning
// ============================================================================

/**
 * Scan all agents and their plugins for configured MCP servers.
 */
export async function scanAllMcps(): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];
  const seenIds = new Set<string>();
  const home = getHome();

  // ---- Main config files ----
  const mainSources: ScannedMcp[] = [
    ...(await scanClaudeMcps(path.join(home, '.mcp.json'))),
    ...(await scanCodexMcps(path.join(home, '.codex', 'config.toml'))),
    ...(await scanAntigravityMcps(path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'))),
    ...(await scanAntigravityMcps(path.join(home, '.gemini', 'antigravity', 'mcp_config.json'))),
    ...(await scanAntigravityMcps(path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json'))),
    // Raw antigravity config dir
    ...(await scanPluginDirMcps(path.join(home, '.gemini', 'config'), 'antigravity')),
  ];

  for (const mcp of mainSources) {
    if (!seenIds.has(mcp.id) && (mcp.recipe.command || mcp.recipe.url)) {
      seenIds.add(mcp.id);
      results.push(mcp);
    }
  }

  // ---- Plugin .mcp.json files ----

  // Claude plugin cache: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json
  await scanPluginMcpsDir(home, '.claude/plugins/cache', 'claude', 3, results, seenIds);

  // Claude plugin marketplaces (external_plugins): ~/.claude/plugins/marketplaces/*/external_plugins/*/.mcp.json
  await scanPluginMcpsDir(home, '.claude/plugins/marketplaces', 'claude', null, results, seenIds);

  // Codex plugins: ~/.codex/.tmp/plugins/plugins/*/.mcp.json
  await scanPluginMcpsDir(home, '.codex/.tmp/plugins/plugins', 'codex', 1, results, seenIds);

  // Codex bundled marketplaces: ~/.codex/.tmp/bundled-marketplaces/*/plugins/*/.mcp.json
  await scanPluginMcpsDir(home, '.codex/.tmp/bundled-marketplaces', 'codex', null, results, seenIds);

  // Codex plugin cache
  await scanPluginMcpsDir(home, '.codex/plugins/cache', 'codex', null, results, seenIds);

  // Antigravity plugins: ~/.gemini/config/plugins/*/.mcp.json
  await scanPluginMcpsDir(home, '.gemini/config/plugins', 'antigravity', 1, results, seenIds);

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Recursively scan a directory tree for .mcp.json files and extract MCP configs.
 * `depth` = number of directory levels to search under baseDir (null = full depth).
 */
async function scanPluginMcpsDir(
  home: string,
  relativePath: string,
  agent: TargetName,
  depth: number | null,
  results: ScannedMcp[],
  seenIds: Set<string>,
): Promise<void> {
  const baseDir = path.join(home, ...relativePath.split('/'));

  try {
    await fs.access(baseDir);
  } catch {
    return;
  }

  // Walk the directory tree
  const discovered = await walkForMcpJson(baseDir, depth, 0);
  for (const mcpPath of discovered) {
    const mcps = await parseMcpJsonFile(mcpPath, agent);
    for (const mcp of mcps) {
      if (!seenIds.has(mcp.id) && (mcp.recipe.command || mcp.recipe.url)) {
        seenIds.add(mcp.id);
        results.push(mcp);
      }
    }
  }
}

/**
 * Walk a directory tree looking for .mcp.json files.
 */
async function walkForMcpJson(dir: string, maxDepth: number | null, currentDepth: number): Promise<string[]> {
  const results: string[] = [];
  if (maxDepth !== null && currentDepth > maxDepth + 2) return results; // +2 for plugin/version levels

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Check for .mcp.json in this dir
      const mcpJsonPath = path.join(fullPath, '.mcp.json');
      try {
        await fs.access(mcpJsonPath);
        results.push(mcpJsonPath);
      } catch {
        // No .mcp.json here, continue walking
      }

      // Continue walking (with depth limit for cache dirs that go deep)
      if (maxDepth === null || currentDepth < maxDepth) {
        const subResults = await walkForMcpJson(fullPath, maxDepth, currentDepth + 1);
        results.push(...subResults);
      }
    }
  }

  return results;
}

/**
 * Parse a .mcp.json file and return MCP entries.
 * Handles both formats:
 *   1. { "mcpServers": { "name": { ... } } }  (standard)
 *   2. { "name": { "command": ..., "args": ... } }  (direct, plugin style)
 */
async function parseMcpJsonFile(filePath: string, agent: TargetName): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(raw);

    // Determine format
    const servers: Record<string, any> = config.mcpServers || config;

    for (const [name, server] of Object.entries(servers)) {
      // Skip top-level keys that aren't MCP server configs
      if (name === 'mcpServers') continue;
      if (!server || typeof server !== 'object') continue;
      if (!server.command && !server.url) continue;

      const recipe: McpRecipe = {};

      if (server.url) {
        recipe.transport = server.type === 'stdio' ? 'stdio' : 'http';
        recipe.url = server.url;
      } else if (server.command) {
        recipe.transport = 'stdio';
        recipe.command = server.command;
        if (server.args) recipe.args = server.args;
      } else {
        continue; // Neither command nor url
      }

      if (server.cwd) recipe.cwd = server.cwd;
      if (server.env) recipe.env = server.env;

      results.push({
        id: name,
        recipe,
        source: `plugin:${agent}`,
        agent,
        enabled: server.enabled !== false,
      });
    }
  } catch {
    // Parse error, skip
  }

  return results;
}

/**
 * Scan a single directory for .mcp.json and return MCPs (used for antigravity config dir).
 */
async function scanPluginDirMcps(dir: string, agent: TargetName): Promise<ScannedMcp[]> {
  const mcpJsonPath = path.join(dir, '.mcp.json');
  try {
    await fs.access(mcpJsonPath);
    return parseMcpJsonFile(mcpJsonPath, agent);
  } catch {
    return [];
  }
}

async function scanClaudeMcps(configPath: string): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);

    if (!config.mcpServers) return results;

    for (const [name, server] of Object.entries(config.mcpServers) as [string, any][]) {
      const recipe: McpRecipe = {};

      if (server.url) {
        recipe.transport = 'http';
        recipe.url = server.url;
      } else {
        recipe.transport = 'stdio';
        if (server.command) recipe.command = server.command;
        if (server.args) recipe.args = server.args;
      }
      if (server.env) recipe.env = server.env;

      results.push({
        id: name,
        recipe,
        source: 'claude',
        agent: 'claude',
      });
    }
  } catch {
    // File doesn't exist or parse error
  }

  return results;
}

async function scanCodexMcps(configPath: string): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    // Parse TOML
    const TOML = await import('smol-toml');
    const config = TOML.parse(raw) as any;

    const mcpServers = config.mcp_servers;
    if (!mcpServers || typeof mcpServers !== 'object') return results;

    for (const [name, server] of Object.entries(mcpServers) as [string, any][]) {
      if (typeof server !== 'object' || server === null) continue;

      const recipe: McpRecipe = { transport: 'stdio' };

      if (server.url) {
        recipe.transport = 'http';
        recipe.url = String(server.url);
      } else {
        if (server.command) recipe.command = String(server.command);
        if (server.args) {
          recipe.args = Array.isArray(server.args)
            ? server.args.map(String)
            : undefined;
        }
      }
      if (server.cwd) recipe.cwd = String(server.cwd);

      // Extract env
      const env: Record<string, string> = {};
      if (server.env && typeof server.env === 'object') {
        for (const [k, v] of Object.entries(server.env as Record<string, any>)) {
          env[k] = String(v);
        }
      }
      if (Object.keys(env).length > 0) recipe.env = env;

      results.push({
        id: name,
        recipe,
        source: 'codex',
        agent: 'codex',
        enabled: server.enabled !== false,
      });
    }
  } catch {
    // File doesn't exist or parse error
  }

  return results;
}

async function scanAntigravityMcps(configPath: string): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);

    if (!config.mcpServers) return results;

    for (const [name, server] of Object.entries(config.mcpServers) as [string, any][]) {
      const recipe: McpRecipe = {};

      if (server.url) {
        recipe.transport = 'http';
        recipe.url = server.url;
      } else {
        recipe.transport = 'stdio';
        if (server.command) recipe.command = server.command;
        if (server.args) recipe.args = server.args;
      }
      if (server.env) recipe.env = server.env;

      results.push({
        id: name,
        recipe,
        source: 'antigravity',
        agent: 'antigravity',
      });
    }
  } catch {
    // File doesn't exist or parse error
  }

  return results;
}
