/**
 * Plugin Scanner
 *
 * Discovers plugins across Claude Code, Codex, and Antigravity CLI.
 * Reads plugin manifests and normalizes them into a unified format.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TargetName, PluginManifest, PluginScanResult } from './types.js';
import { getCatalogDir } from './acm-config.js';

// ============================================================================
// Types
// ============================================================================

interface PluginSource {
  /** Base directory to scan */
  baseDir: string;
  /** Which agent this source belongs to */
  agent: TargetName;
  /** How to find the manifest */
  manifestPath: string; // relative to plugin dir, e.g. ".codex-plugin/plugin.json"
}

// ============================================================================
// Plugin Source Definitions
// ============================================================================

function getHome(): string {
  return os.homedir();
}

function getPluginSources(): PluginSource[] {
  const home = getHome();
  return [
    // The catalog itself. Listed first so an imported plugin is the one
    // installed, rather than whichever provider happens to hold a copy.
    {
      baseDir: path.join(getCatalogDir(), 'plugins'),
      agent: 'claude',
      manifestPath: '.claude-plugin/plugin.json',
    },
    // Codex plugins (most comprehensive)
    {
      baseDir: path.join(home, '.codex', '.tmp', 'plugins', 'plugins'),
      agent: 'codex',
      manifestPath: '.codex-plugin/plugin.json',
    },
    // Claude official plugins
    {
      baseDir: path.join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins'),
      agent: 'claude',
      manifestPath: '.claude-plugin/plugin.json',
    },
    // Claude external plugins (MCP-only typically)
    {
      baseDir: path.join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'external_plugins'),
      agent: 'claude',
      manifestPath: '.claude-plugin/plugin.json',
    },
    // Antigravity plugins
    {
      baseDir: path.join(home, '.gemini', 'config', 'plugins'),
      agent: 'antigravity',
      manifestPath: 'plugin.json',
    },
    // Codex bundled marketplaces
    {
      baseDir: path.join(home, '.codex', '.tmp', 'bundled-marketplaces'),
      agent: 'codex',
      manifestPath: '.codex-plugin/plugin.json',
    },
  ];
}

// ============================================================================
// Plugin Discovery
// ============================================================================

/**
 * Scan all agent directories for plugins.
 */
export async function scanAllPlugins(): Promise<PluginScanResult[]> {
  const results: PluginScanResult[] = [];
  const seen = new Set<string>();
  const sources = getPluginSources();

  for (const source of sources) {
    const plugins = await scanPluginSource(source);
    for (const plugin of plugins) {
      const dedupKey = `${plugin.agent}:${plugin.name}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        results.push(plugin);
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanPluginSource(source: PluginSource): Promise<PluginScanResult[]> {
  const results: PluginScanResult[] = [];

  try {
    await fs.access(source.baseDir);
  } catch {
    return results; // Directory doesn't exist
  }

  let pluginDirs: string[] = [];

  if (source.manifestPath === '.codex-plugin/plugin.json' &&
      source.baseDir.includes('bundled-marketplaces')) {
    // Nested-deep: bundled-marketplaces/<marketplace>/plugins/<plugin>/
    try {
      const marketplaces = await fs.readdir(source.baseDir, { withFileTypes: true });
      for (const mp of marketplaces) {
        if (!mp.isDirectory() || mp.name.startsWith('.')) continue;
        const pluginsDir = path.join(source.baseDir, mp.name, 'plugins');
        try {
          const plugins = await fs.readdir(pluginsDir, { withFileTypes: true });
          for (const p of plugins) {
            if (p.isDirectory() && !p.name.startsWith('.')) {
              pluginDirs.push(path.join(pluginsDir, p.name));
            }
          }
        } catch {}
      }
    } catch {}
  } else {
    // Direct or nested: baseDir/<plugin>/
    try {
      const entries = await fs.readdir(source.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          pluginDirs.push(path.join(source.baseDir, entry.name));
        }
      }
    } catch {}
  }

  for (const dir of pluginDirs) {
    const manifestPath = path.join(dir, source.manifestPath);
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw) as PluginManifest;

      // Count components
      const skillsDir = path.join(dir, 'skills');
      const mcpPath = path.join(dir, '.mcp.json');
      const agentsDir = path.join(dir, 'agents');

      let skillCount = 0;
      try {
        const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const se of skillEntries) {
          if (se.isDirectory() && !se.name.startsWith('.') && !se.name.startsWith('_')) {
            // Check if SKILL.md exists
            try {
              await fs.access(path.join(skillsDir, se.name, 'SKILL.md'));
              skillCount++;
            } catch {}
          }
        }
      } catch {}

      let mcpCount = 0;
      try {
        await fs.access(mcpPath);
        mcpCount = 1; // Has .mcp.json (we count the file, not individual servers)
      } catch {}

      let agentCount = 0;
      try {
        const agentEntries = await fs.readdir(agentsDir, { withFileTypes: true });
        for (const ae of agentEntries) {
          if (ae.isFile() && (ae.name.endsWith('.md') || ae.name.endsWith('.yaml'))) {
            agentCount++;
          }
        }
      } catch {}

      results.push({
        name: manifest.name || path.basename(dir),
        version: manifest.version,
        description: manifest.description ?? manifest.interface?.shortDescription,
        author: manifest.author?.name,
        category: manifest.interface?.category,
        agent: source.agent,
        sourcePath: dir,
        skills: skillCount,
        mcps: mcpCount,
        agents: agentCount,
      });
    } catch {
      // No manifest or parse error, skip
    }
  }

  return results;
}

// ============================================================================
// Plugin Detail (for install)
// ============================================================================

export interface PluginDetail {
  manifest: PluginManifest;
  agent: TargetName;
  sourcePath: string;
  skills: { id: string; skillPath: string }[];
  mcpConfigPath?: string;
  mcpServers: Record<string, any>;
  agentFiles: string[];
  knowledgeFiles: string[];
  commandFiles: string[];
}

/**
 * Get detailed plugin information for installation.
 */
export async function getPluginDetail(pluginName: string): Promise<PluginDetail | null> {
  const sources = getPluginSources();

  for (const source of sources) {
    try {
      await fs.access(source.baseDir);
    } catch {
      continue;
    }

    // Find plugin directory — handle both flat and nested layouts
    let pluginDir: string | null = null;

    if (source.manifestPath === '.codex-plugin/plugin.json' &&
        source.baseDir.includes('bundled-marketplaces')) {
      // Nested-deep: bundled-marketplaces/<marketplace>/plugins/<plugin>/
      try {
        const marketplaces = await fs.readdir(source.baseDir, { withFileTypes: true });
        for (const mp of marketplaces) {
          if (!mp.isDirectory() || mp.name.startsWith('.')) continue;
          const pluginsDir = path.join(source.baseDir, mp.name, 'plugins');
          try {
            await fs.access(path.join(pluginsDir, pluginName));
            pluginDir = path.join(pluginsDir, pluginName);
            break;
          } catch {}
        }
      } catch {}
    } else {
      // Flat or simple nested: baseDir/<plugin>/
      try {
        await fs.access(path.join(source.baseDir, pluginName));
        pluginDir = path.join(source.baseDir, pluginName);
      } catch {}
    }

    if (!pluginDir) continue;

    try {

      const manifestPath = path.join(pluginDir, source.manifestPath);
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest: PluginManifest = JSON.parse(raw);

      // Skills
      const skills: { id: string; skillPath: string }[] = [];
      const skillsDir = path.join(pluginDir, 'skills');
      try {
        const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const se of skillEntries) {
          if (!se.isDirectory() || se.name.startsWith('.') || se.name.startsWith('_')) continue;
          const skillMdPath = path.join(skillsDir, se.name, 'SKILL.md');
          try {
            await fs.access(skillMdPath);
            skills.push({ id: se.name, skillPath: skillMdPath });
          } catch {}
        }
      } catch {}

      // MCP
      let mcpConfigPath: string | undefined;
      let mcpServers: Record<string, any> = {};
      const mcpPath = path.join(pluginDir, '.mcp.json');
      try {
        await fs.access(mcpPath);
        const mcpRaw = await fs.readFile(mcpPath, 'utf8');
        const mcpConfig = JSON.parse(mcpRaw);
        mcpServers = mcpConfig.mcpServers || mcpConfig;
        mcpConfigPath = mcpPath;
      } catch {}

      // Agents
      const agentFiles: string[] = [];
      const agentsDir = path.join(pluginDir, 'agents');
      try {
        const agentEntries = await fs.readdir(agentsDir, { withFileTypes: true });
        for (const ae of agentEntries) {
          if (ae.isFile() && ae.name.endsWith('.md')) {
            agentFiles.push(ae.name);
          }
        }
      } catch {}

      // Knowledge files (AGENTS.md, vercel.md, etc.)
      const knowledgeFiles: string[] = [];
      const knowledgeNames = ['AGENTS.md', 'vercel.md', 'README.md'];
      for (const kn of knowledgeNames) {
        try {
          await fs.access(path.join(pluginDir, kn));
          knowledgeFiles.push(kn);
        } catch {}
      }

      // Command files
      const commandFiles: string[] = [];
      const commandsDir = path.join(pluginDir, 'commands');
      try {
        const cmdEntries = await fs.readdir(commandsDir, { withFileTypes: true });
        for (const ce of cmdEntries) {
          if (ce.isFile() && ce.name.endsWith('.md')) {
            commandFiles.push(ce.name);
          }
        }
      } catch {}

      return {
        manifest,
        agent: source.agent,
        sourcePath: pluginDir,
        skills,
        mcpConfigPath,
        mcpServers,
        agentFiles,
        knowledgeFiles,
        commandFiles,
      };
    } catch {
      continue;
    }
  }

  return null;
}
