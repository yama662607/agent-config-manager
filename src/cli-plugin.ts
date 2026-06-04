/**
 * `acm plugin` CLI commands
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanAllPlugins, getPluginDetail, type PluginDetail } from './plugin-scanner.js';
import {
  listPlugins,
  addPluginEntry,
  removePluginEntry,
  getPluginEntry,
  getPluginInstallDir,
  validatePluginName,
} from './plugins-metadata.js';
import type { PluginEntry, TargetName } from './types.js';
import { padRightWide, truncateWide } from './table-utils.js';

const home = os.homedir();

// ============================================================================
// Agent-specific paths
// ============================================================================

/** Agent-native plugin directories (where agents discover plugins) */
const AGENT_PLUGIN_DIR: Record<TargetName, string> = {
  claude: path.join(home, '.claude', 'plugins'),
  codex: path.join(home, '.codex', '.tmp', 'plugins', 'plugins'),
  antigravity: path.join(home, '.gemini', 'config', 'plugins'),
};

// ============================================================================
// Helpers
// ============================================================================

const TARGET_ALIASES: Record<string, TargetName> = {
  c: 'claude', claude: 'claude',
  x: 'codex', codex: 'codex',
  a: 'antigravity', agy: 'antigravity', antigravity: 'antigravity', g: 'antigravity',
};

function parseFlag(argv: string[], ...names: string[]): boolean {
  return argv.some(a => names.includes(a));
}

function parseTargets(argv: string[]): TargetName[] {
  const idx = argv.findIndex(a => a === "--target" || a === "-t");
  if (idx < 0 || idx + 1 >= argv.length) return ["claude"];
  const raw = argv[idx + 1];
  if (raw === 'all') return ['claude', 'codex', 'antigravity'];
  return raw.split(',').map(t => {
    const trimmed = t.trim().toLowerCase();
    const resolved = TARGET_ALIASES[trimmed];
    if (!resolved) {
      throw new Error(`Invalid target: '${trimmed}'. Valid: claude(c), codex(x), antigravity(a,g,agy), all`);
    }
    return resolved;
  });
}

// ============================================================================
// Scan Command
// ============================================================================

export async function pluginScan(): Promise<void> {
  console.log('🔍 Scanning plugins across agents...\n');
  const plugins = await scanAllPlugins();

  if (plugins.length === 0) {
    console.log('  No plugins found.');
    return;
  }

  const NAME_W = 30, VER_W = 8, AGENT_W = 12, SKILLS_W = 7, MCPS_W = 5, AGENTS_W = 7;

  const borderH = '┌' + '─'.repeat(NAME_W + 2) + '┬' + '─'.repeat(VER_W + 2) + '┬' + '─'.repeat(AGENT_W + 2) + '┬' + '─'.repeat(SKILLS_W + 2) + '┬' + '─'.repeat(MCPS_W + 2) + '┬' + '─'.repeat(AGENTS_W + 2) + '┐';
  const borderM = '├' + '─'.repeat(NAME_W + 2) + '┼' + '─'.repeat(VER_W + 2) + '┼' + '─'.repeat(AGENT_W + 2) + '┼' + '─'.repeat(SKILLS_W + 2) + '┼' + '─'.repeat(MCPS_W + 2) + '┼' + '─'.repeat(AGENTS_W + 2) + '┤';
  const borderF = '└' + '─'.repeat(NAME_W + 2) + '┴' + '─'.repeat(VER_W + 2) + '┴' + '─'.repeat(AGENT_W + 2) + '┴' + '─'.repeat(SKILLS_W + 2) + '┴' + '─'.repeat(MCPS_W + 2) + '┴' + '─'.repeat(AGENTS_W + 2) + '┘';

  console.log(`Found ${plugins.length} plugin(s):\n`);
  console.log(borderH);
  console.log('│ ' + padRightWide('Plugin', NAME_W) + ' │ ' + padRightWide('Version', VER_W) + ' │ ' + padRightWide('Agent', AGENT_W) + ' │ ' + padRightWide('Skills', SKILLS_W) + ' │ ' + padRightWide('MCPs', MCPS_W) + ' │ ' + padRightWide('Agents', AGENTS_W) + ' │');
  console.log(borderM);

  for (const p of plugins) {
    const name = truncateWide(p.name, NAME_W);
    const ver = truncateWide(p.version || '-', VER_W);
    const agent = padRightWide(p.agent, AGENT_W);
    const skills = String(p.skills).padStart(3);
    const mcps = String(p.mcps).padStart(3);
    const ags = String(p.agents).padStart(3);
    console.log('│ ' + padRightWide(name, NAME_W) + ' │ ' + padRightWide(ver, VER_W) + ' │ ' + agent + ' │  ' + skills + '   │  ' + mcps + ' │  ' + ags + '  │');
  }

  console.log(borderF);
}

// ============================================================================
// List Command
// ============================================================================

export async function pluginList(): Promise<void> {
  const plugins = await listPlugins();

  if (plugins.length === 0) {
    console.log('No plugins installed.\n');
    console.log('Run `acm plugin scan` to discover available plugins.');
    console.log('Run `acm plugin install <name>` to install a plugin.');
    return;
  }

  console.log(`Installed Plugins (${plugins.length}):\n`);

  const NAME_W = 30, VER_W = 8, AGENT_W = 12, SKILLS_W = 7, MCPS_W = 5;
  const borderH = '┌' + '─'.repeat(NAME_W + 2) + '┬' + '─'.repeat(VER_W + 2) + '┬' + '─'.repeat(AGENT_W + 2) + '┬' + '─'.repeat(SKILLS_W + 2) + '┬' + '─'.repeat(MCPS_W + 2) + '┐';

  console.log(borderH);
  console.log('│ ' + padRightWide('Plugin', NAME_W) + ' │ ' + padRightWide('Version', VER_W) + ' │ ' + padRightWide('Agent', AGENT_W) + ' │ ' + padRightWide('Skills', SKILLS_W) + ' │ ' + padRightWide('MCPs', MCPS_W) + ' │');
  console.log('├' + '─'.repeat(NAME_W + 2) + '┼' + '─'.repeat(VER_W + 2) + '┼' + '─'.repeat(AGENT_W + 2) + '┼' + '─'.repeat(SKILLS_W + 2) + '┼' + '─'.repeat(MCPS_W + 2) + '┤');

  for (const p of plugins) {
    const name = truncateWide(p.name, NAME_W);
    const ver = truncateWide(p.version || '-', VER_W);
    const agent = padRightWide(p.agent, AGENT_W);
    const skills = String(p.skills.length).padStart(3);
    const mcps = String(p.mcps.length).padStart(3);
    console.log('│ ' + padRightWide(name, NAME_W) + ' │ ' + padRightWide(ver, VER_W) + ' │ ' + agent + ' │  ' + skills + '   │  ' + mcps + '  │');
  }

  const borderF = '└' + '─'.repeat(NAME_W + 2) + '┴' + '─'.repeat(VER_W + 2) + '┴' + '─'.repeat(AGENT_W + 2) + '┴' + '─'.repeat(SKILLS_W + 2) + '┴' + '─'.repeat(MCPS_W + 2) + '┘';
  console.log(borderF);
}

// ============================================================================
// Show Command
// ============================================================================

export async function pluginShow(name: string): Promise<void> {
  const detail = await getPluginDetail(name);

  if (!detail) {
    console.error(`Plugin not found: ${name}\n`);
    console.log('Run `acm plugin scan` to see available plugins.');
    process.exitCode = 1;
    return;
  }

  const iface = detail.manifest.interface;
  console.log(`Plugin: ${iface?.displayName || detail.manifest.name}\n`);
  console.log(`  Name:       ${detail.manifest.name}`);
  console.log(`  Version:    ${detail.manifest.version || '-'}`);
  console.log(`  Agent:      ${detail.agent}`);
  console.log(`  Author:     ${detail.manifest.author?.name || '-'}`);
  console.log(`  License:    ${detail.manifest.license || '-'}`);
  console.log(`  Category:   ${iface?.category || '-'}`);
  console.log(`  Homepage:   ${detail.manifest.homepage || '-'}`);
  console.log(`  Repository: ${detail.manifest.repository || '-'}`);
  if (detail.manifest.keywords?.length) {
    console.log(`  Keywords:   ${detail.manifest.keywords.join(', ')}`);
  }
  if (iface?.capabilities?.length) {
    console.log(`  Capabilities: ${iface.capabilities.join(', ')}`);
  }
  if (iface?.brandColor) {
    console.log(`  Brand Color: ${iface.brandColor}`);
  }
  console.log(`  Description: ${iface?.shortDescription || detail.manifest.description || '-'}`);
  if (iface?.longDescription) {
    console.log(`  Details:    ${iface.longDescription}`);
  }
  if (iface?.defaultPrompt?.length) {
    console.log(`  Default Prompts:`);
    for (const p of iface.defaultPrompt) console.log(`    > ${p}`);
  }
  console.log(`\n  Skills (${detail.skills.length}):`);
  for (const s of detail.skills) {
    console.log(`    - ${s.id}`);
  }
  if (detail.mcpConfigPath) {
    console.log(`\n  MCP: .mcp.json (${Object.keys(detail.mcpServers).length} servers)`);
    for (const [name, server] of Object.entries(detail.mcpServers)) {
      if (name === 'mcpServers') continue;
      console.log(`    - ${name}: ${server.url ? 'http' : 'stdio'}${server.command ? ' (' + server.command + ')' : ''}`);
    }
  }
  if (detail.agentFiles.length) {
    console.log(`\n  Agents (${detail.agentFiles.length}):`);
    for (const a of detail.agentFiles) console.log(`    - ${a}`);
  }
  if (detail.knowledgeFiles.length) {
    console.log(`\n  Knowledge: ${detail.knowledgeFiles.join(', ')}`);
  }
  if (detail.commandFiles.length) {
    console.log(`\n  Commands (${detail.commandFiles.length}):`);
    for (const c of detail.commandFiles) console.log(`    - ${c}`);
  }
  console.log();
}

// ============================================================================
// Install Command
// ============================================================================

export async function pluginInstall(name: string, argv: string[]): Promise<void> {
  // Validate plugin name
  try {
    validatePluginName(name);
  } catch (err: any) {
    console.error(`Invalid plugin name: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Warn if empty plugin
  const detail = await getPluginDetail(name);
  if (!detail) {
    console.error(`Plugin not found: ${name}\n`);
    console.log('Run `acm plugin scan` to see available plugins.');
    process.exitCode = 1;
    return;
  }

  if (detail.skills.length === 0 && !detail.mcpConfigPath && detail.agentFiles.length === 0) {
    console.error(`Plugin '${name}' has no skills, MCPs, or agents. Nothing to install.\n`);
    process.exitCode = 1;
    return;
  }

  let targets: TargetName[];
  try {
    targets = parseTargets(argv);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Installing plugin: ${name} (source: ${detail.agent})\n`);

  const mcpsFromPlugin = detail.mcpConfigPath
    ? Object.keys(detail.mcpServers).filter(k => k !== 'mcpServers').length
    : 0;
  const installedTargets: TargetName[] = [];
  const newTargetDirs: string[] = [];

  // Install to agent-native plugin directories (with rollback on failure)
  try {
    for (const target of targets) {
      const targetDir = path.join(AGENT_PLUGIN_DIR[target], name);

      // Check registry, not filesystem, for reinstall guard
      const existing = await getPluginEntry(name);
      if (existing && existing.agentFiles) {
        console.log(`  ⏭️  [${target}] Already installed (registry). Use --target to reinstall.`);
        installedTargets.push(target);
        continue;
      }

      try { await fs.access(targetDir); } catch {
        console.log(`  📦 [${target}] Copying plugin (${detail.skills.length} skills, ${mcpsFromPlugin} MCPs)...`);
        await fs.cp(detail.sourcePath, targetDir, { recursive: true, dereference: false });
        newTargetDirs.push(targetDir);

        if (target !== detail.agent) {
          await adaptManifest(targetDir, target, detail);
        }
        if (target === 'antigravity' && detail.mcpConfigPath) {
          await adaptMcpForAntigravity(targetDir);
        }
        installedTargets.push(target);
        continue;
      }
      console.log(`  ⏭️  [${target}] Already installed at: ${targetDir}`);
      installedTargets.push(target);
    }

    // Add skills to acm catalog
    const { addSkill, normalizeSkillPackage, getSkill } = await import('./catalog.js');
    let catalogSkillsAdded = 0;
    for (const skill of detail.skills) {
      const existing = await getSkill(skill.id);
      if (!existing) {
        const skillContent = await fs.readFile(skill.skillPath, 'utf8');
        const entry = normalizeSkillPackage(skill.id, skillContent, {
          tags: ['plugin', detail.manifest.name],
        });
        await addSkill(entry, skillContent);
        catalogSkillsAdded++;
      }
    }
    if (catalogSkillsAdded > 0) console.log(`  ✅ [catalog] ${catalogSkillsAdded} skills registered`);

    // Save management copy to ~/.acm/plugins/
    const acmPluginDir = getPluginInstallDir(name);
    await fs.mkdir(acmPluginDir, { recursive: true });
    await fs.cp(detail.sourcePath, acmPluginDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'skills' && path.basename(src) !== '.mcp.json' && !src.endsWith('/skills') && !src.endsWith('/.mcp.json'),
      dereference: false,
      force: true,
    });

    // Read original manifest
    const originalManifestPath = path.join(acmPluginDir, '.codex-plugin', 'plugin.json');
    const altManifestPath = path.join(acmPluginDir, '.claude-plugin', 'plugin.json');
    const rootManifestPath = path.join(acmPluginDir, 'plugin.json');
    let originalManifest: any = {};
    try { originalManifest = JSON.parse(await fs.readFile(originalManifestPath, 'utf8')); } catch {
      try { originalManifest = JSON.parse(await fs.readFile(altManifestPath, 'utf8')); } catch {
        try { originalManifest = JSON.parse(await fs.readFile(rootManifestPath, 'utf8')); } catch {}
      }
    }
    if (!originalManifest || typeof originalManifest !== 'object') originalManifest = {};

    await fs.writeFile(
      path.join(acmPluginDir, 'plugin.json'),
      JSON.stringify({ ...originalManifest, sourceAgent: detail.agent, installedFor: installedTargets, installedAt: new Date().toISOString(), skills: detail.skills.map(s => s.id), mcps: Object.keys(detail.mcpServers).filter(k => k !== 'mcpServers'), agentFiles: detail.agentFiles, knowledgeFiles: detail.knowledgeFiles, commandFiles: detail.commandFiles }, null, 2),
      'utf8'
    );

    // Update registry
    const iface = detail.manifest.interface;
    const entry: PluginEntry = {
      name, version: detail.manifest.version, description: detail.manifest.description,
      author: detail.manifest.author?.name, homepage: detail.manifest.homepage,
      repository: detail.manifest.repository, license: detail.manifest.license,
      keywords: detail.manifest.keywords, category: iface?.category,
      displayName: iface?.displayName, longDescription: iface?.longDescription,
      capabilities: iface?.capabilities, defaultPrompt: iface?.defaultPrompt,
      brandColor: iface?.brandColor, privacyPolicyURL: iface?.privacyPolicyURL,
      termsOfServiceURL: iface?.termsOfServiceURL,
      agent: detail.agent, installedFor: installedTargets, sourcePath: detail.sourcePath,
      skills: detail.skills.map(s => s.id),
      mcps: Object.keys(detail.mcpServers).filter(k => k !== 'mcpServers'),
      agentFiles: detail.agentFiles, knowledgeFiles: detail.knowledgeFiles,
      commandFiles: detail.commandFiles,
      installedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await addPluginEntry(entry);

  } catch (err: any) {
    // Rollback: remove any agent dirs we created
    console.error(`\n  ❌ Install failed: ${err.message}`);
    console.error(`  Rolling back...`);
    for (const dir of newTargetDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); console.error(`    Removed: ${dir}`); } catch {}
    }
    process.exitCode = 1;
    return;
  }

  // Summary
  const pluginDirs = installedTargets.map(t => AGENT_PLUGIN_DIR[t] + '/' + name).join('\n    ');
  console.log(`\n📦 Install summary:`);
  console.log(`  Plugin dirs:\n    ${pluginDirs}`);
  console.log(`  Skills: ${detail.skills.length} | MCPs: ${mcpsFromPlugin} | Agents: ${detail.agentFiles.length} | Commands: ${detail.commandFiles.length} | Knowledge: ${detail.knowledgeFiles.length}`);
  console.log();
}

/**
 * Adapt manifest format when installing a plugin from one agent to another.
 * e.g., Codex (.codex-plugin/plugin.json) → Claude (.claude-plugin/plugin.json)
 */
async function adaptManifest(pluginDir: string, target: TargetName, detail: PluginDetail): Promise<void> {
  const srcManifestPath = path.join(pluginDir, '.codex-plugin', 'plugin.json');
  const altSrcManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const rootManifestPath = path.join(pluginDir, 'plugin.json');

  // Find source manifest
  let srcManifest: string | null = null;
  try { srcManifest = await fs.readFile(srcManifestPath, 'utf8'); } catch {
    try { srcManifest = await fs.readFile(altSrcManifestPath, 'utf8'); } catch {
      try { srcManifest = await fs.readFile(rootManifestPath, 'utf8'); } catch {}
    }
  }
  if (!srcManifest) return;

  let manifest: any;
  try {
    manifest = JSON.parse(srcManifest);
  } catch {
    console.error(`  ⚠️  [${target}] Could not parse manifest for adaptation, skipping`);
    return;
  }
  if (!manifest || typeof manifest !== 'object') {
    console.error(`  ⚠️  [${target}] Manifest is not a valid object, skipping adaptation`);
    return;
  }

  // Claude: manifest must be at .claude-plugin/plugin.json (minimal format)
  if (target === 'claude') {
    const claudeDir = path.join(pluginDir, '.claude-plugin');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, 'plugin.json'),
      JSON.stringify({
        name: manifest.name || detail.manifest.name,
        description: manifest.description || detail.manifest.description || '',
        author: manifest.author || { name: detail.manifest.author?.name || '' },
      }, null, 2),
      'utf8'
    );
    // Remove non-Claude manifest
    await fs.rm(srcManifestPath, { force: true });
    await fs.rm(rootManifestPath, { force: true });
  }

  // Codex: manifest at .codex-plugin/plugin.json
  if (target === 'codex') {
    const codexDir = path.join(pluginDir, '.codex-plugin');
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, 'plugin.json'), srcManifest, 'utf8');
    await fs.rm(altSrcManifestPath, { force: true });
    await fs.rm(rootManifestPath, { force: true });
  }

  // Antigravity: manifest at root plugin.json (already there if source was antigravity)
  if (target === 'antigravity' && detail.agent !== 'antigravity') {
    await fs.writeFile(rootManifestPath, srcManifest, 'utf8');
    await fs.rm(srcManifestPath, { force: true });
    await fs.rm(altSrcManifestPath, { force: true });
  }
}

/**
 * Adapt MCP config for Antigravity:
 * - Convert `url` → `serverUrl` in .mcp.json
 * - Add servers to ~/.gemini/config/mcp_config.json
 */
async function adaptMcpForAntigravity(pluginDir: string): Promise<void> {
  const mcpPath = path.join(pluginDir, '.mcp.json');
  try { await fs.access(mcpPath); } catch { return; }

  const raw = await fs.readFile(mcpPath, 'utf8');
  const config = JSON.parse(raw);
  const servers = config.mcpServers || config;

  // Update Antigravity's main MCP config
  const agyConfigPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
  let agyConfig: any = { mcpServers: {} };
  try {
    const agyRaw = await fs.readFile(agyConfigPath, 'utf8');
    agyConfig = JSON.parse(agyRaw);
  } catch {}

  if (!agyConfig.mcpServers) agyConfig.mcpServers = {};

  for (const [name, server] of Object.entries(servers)) {
    if (name === 'mcpServers' || !server || typeof server !== 'object') continue;
    const s = server as any;

    // Convert url → serverUrl for Antigravity
    const agyServer: any = {};
    if (s.url) {
      agyServer.serverUrl = s.url;
    } else if (s.command) {
      agyServer.command = s.command;
      if (s.args) agyServer.args = s.args;
    }
    if (s.env) agyServer.env = s.env;
    if (s.cwd) agyServer.cwd = s.cwd;

    agyConfig.mcpServers[name] = agyServer;
  }

  await fs.writeFile(agyConfigPath, JSON.stringify(agyConfig, null, 2), 'utf8');
}

// ============================================================================
// Uninstall Command
// ============================================================================

export async function pluginUninstall(name: string, argv: string[]): Promise<void> {
  try { validatePluginName(name); } catch (err: any) {
    console.error(`Invalid plugin name: ${err.message}`);
    process.exitCode = 1; return;
  }
  const keepSkills = parseFlag(argv, '--keep-skills');
  let targets: TargetName[];
  try {
    targets = parseTargets(argv);
    // For uninstall, if --target not specified, default to all
    if (!argv.some(a => a === '--target' || a === '-t')) {
      targets = ['claude', 'codex', 'antigravity'];
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const entry = await getPluginEntry(name);
  if (!entry) {
    console.error(`Plugin not installed: ${name}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`Uninstalling plugin: ${name}\n`);

  // 1. Clean up Antigravity MCP config if plugin had MCPs
  if (entry.mcps.length > 0) {
    const agyConfigPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
    try {
      const raw = await fs.readFile(agyConfigPath, 'utf8');
      const agyConfig = JSON.parse(raw);
      if (agyConfig.mcpServers) {
        for (const mcpName of entry.mcps) {
          if (agyConfig.mcpServers[mcpName]) {
            delete agyConfig.mcpServers[mcpName];
            console.log(`  ✅ Removed [antigravity] mcp: ${mcpName}`);
          }
        }
        await fs.writeFile(agyConfigPath, JSON.stringify(agyConfig, null, 2), 'utf8');
      }
    } catch {}
  }

  // 2. Remove from agent plugin directories
  for (const target of targets) {
    const targetDir = path.join(AGENT_PLUGIN_DIR[target], name);
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      console.log(`  ✅ Removed [${target}]: ${targetDir}`);
    } catch {
      console.log(`  ⏭️  [${target}] Not found`);
    }
  }

  // 2. Remove skills from acm catalog
  if (!keepSkills) {
    const { removeSkill } = await import('./catalog.js');
    for (const skillId of entry.skills) {
      try {
        await removeSkill(skillId);
        console.log(`  ✅ Removed skill: ${skillId}`);
      } catch (err: any) {
        console.error(`  ⚠️  Could not remove skill: ${skillId} (${err.message})`);
      }
    }
  }

  // 3. Remove from ~/.acm/plugins/
  const pluginDir = getPluginInstallDir(name);
  await fs.rm(pluginDir, { recursive: true, force: true });
  console.log(`  ✅ Removed acm plugin directory`);

  // 4. Remove from registry
  await removePluginEntry(name);
  console.log(`  ✅ Removed from registry`);

  console.log(`\nDone.`);
  if (keepSkills) console.log('Skills were kept (--keep-skills).');
  console.log();
}
