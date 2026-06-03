/**
 * Cross-Agent Scanner
 *
 * Discovers skills and MCPs across Claude Code, Codex, and Antigravity CLI.
 * Read-only: never modifies files outside ~/.acm/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TargetName, McpRecipe } from './types.js';

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
 * Scan all agents for configured MCP servers.
 */
export async function scanAllMcps(): Promise<ScannedMcp[]> {
  const results: ScannedMcp[] = [];
  const home = getHome();

  // Claude Code — ~/.mcp.json
  const claudeMcps = await scanClaudeMcps(path.join(home, '.mcp.json'));
  results.push(...claudeMcps);

  // Codex — ~/.codex/config.toml
  const codexMcps = await scanCodexMcps(path.join(home, '.codex', 'config.toml'));
  results.push(...codexMcps);

  // Antigravity — ~/.gemini/antigravity/mcp_config.json
  const agyMcps = await scanAntigravityMcps(path.join(home, '.gemini', 'antigravity', 'mcp_config.json'));
  results.push(...agyMcps);

  return results.sort((a, b) => a.id.localeCompare(b.id));
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
