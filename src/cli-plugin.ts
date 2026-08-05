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
import type { PluginEntry, TargetName, PluginManifest } from './types.js';
import type { DesktopPlugin } from './desktop-scanner.js';
import { padRightWide, truncateWide } from './table-utils.js';
import { AGENT_PLUGIN_DIR } from './agent-paths.js';
import { getCatalogDir } from './acm-config.js';
import { parseTargetList } from './target-utils.js';

const home = os.homedir();

// ============================================================================
// Agent-specific paths
// ============================================================================


// ============================================================================
// Helpers
// ============================================================================


function parseFlag(argv: string[], ...names: string[]): boolean {
  return argv.some(a => names.includes(a));
}

/** Arguments that are neither a flag nor the value belonging to one. */
function positionalArgs(argv: string[], flagsTakingValue: string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (flagsTakingValue.includes(argv[i])) {
      i++;
      continue;
    }
    if (argv[i].startsWith('-')) continue;
    positional.push(argv[i]);
  }
  return positional;
}

function parseTargets(argv: string[]): TargetName[] {
  const idx = argv.findIndex(a => a === "--target" || a === "-t");
  if (idx < 0 || idx + 1 >= argv.length) return ["claude"];
  return parseTargetList(argv[idx + 1]);
}

// ============================================================================
// Scan Command
// ============================================================================

export async function pluginScan(argv?: string[]): Promise<void> {
  const showDiff = argv?.includes('--diff') ?? false;

  console.log('🔍 Scanning plugins across agents...\n');
  const plugins = await scanAllPlugins();

  if (plugins.length === 0) {
    console.log('  No plugins found.');
    return;
  }

  // --diff mode: compare with previous snapshot (read-only)
  if (showDiff) {
    const { loadSnapshot, diffSnapshots } = await import('./plugin-snapshot.js');
    const prev = await loadSnapshot();
    if (!prev) {
      console.log(`  No snapshot found. Run 'acm plugin snapshot' first.\n`);
      return;
    }
    const current = {
      scannedAt: new Date().toISOString(),
      plugins: Object.fromEntries(plugins.map(p => [p.name, { name: p.name, version: p.version, skills: p.skills, mcps: p.mcps, agents: p.agents }])),
    };
    const diff = diffSnapshots(prev, current);

    console.log(`  📸 Compared to ${prev.scannedAt.slice(0, 10)}:\n`);
    if (diff.added.length) { console.log(`  🆕 Added (${diff.added.length}):`); for (const n of diff.added.slice(0, 10)) console.log(`    + ${n}`); if (diff.added.length > 10) console.log(`    ... +${diff.added.length - 10} more`); console.log(); }
    if (diff.removed.length) { console.log(`  ❌ Removed (${diff.removed.length}):`); for (const n of diff.removed.slice(0, 10)) console.log(`    - ${n}`); if (diff.removed.length > 10) console.log(`    ... -${diff.removed.length - 10} more`); console.log(); }
    if (diff.changed.length) { console.log(`  ✏️  Changed (${diff.changed.length}):`); for (const c of diff.changed.slice(0, 10)) console.log(`    ~ ${c.name}: ${c.field} ${c.before} → ${c.after}`); console.log(); }
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) console.log(`  ✅ No changes since last scan.\n`);
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

      // Skip only the targets this plugin is already installed for. Testing a
      // field that exists on every registry entry — `agentFiles` is an array,
      // and an empty array is truthy — marked every registered plugin as
      // installed everywhere, so nothing was ever copied.
      const existing = await getPluginEntry(name);
      if (existing?.installedFor?.includes(target)) {
        console.log(`  ⏭️  [${target}] Already installed. Remove it first to reinstall.`);
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

    // Add skills to acm catalog.
    //
    // A skill is a directory, not a file: SKILL.md is the entry point but the
    // references, scripts and assets beside it are what the instructions point
    // at. Registering only SKILL.md silently drops them.
    const { addSkillFromDir, getSkill } = await import('./catalog.js');
    let catalogSkillsAdded = 0;
    for (const skill of detail.skills) {
      const existing = await getSkill(skill.id);
      if (!existing) {
        await addSkillFromDir(skill.id, path.dirname(skill.skillPath), {
          tags: ['plugin', detail.manifest.name],
        });
        catalogSkillsAdded++;
      }
    }
    if (catalogSkillsAdded > 0) console.log(`  ✅ [catalog] ${catalogSkillsAdded} skills registered`);

    // Keep a management copy in the catalog. When the plugin already lives
    // there — it was imported rather than discovered in a provider directory —
    // there is nothing to copy.
    const acmPluginDir = getPluginInstallDir(name);
    if (path.resolve(detail.sourcePath) !== path.resolve(acmPluginDir)) {
      await fs.mkdir(acmPluginDir, { recursive: true });
      await fs.cp(detail.sourcePath, acmPluginDir, {
        recursive: true,
        filter: (src) => path.basename(src) !== 'skills' && path.basename(src) !== '.mcp.json' && !src.endsWith('/skills') && !src.endsWith('/.mcp.json'),
        dereference: false,
        force: true,
      });
    }

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

// ============================================================================
// Snapshot Command — Save current state
// ============================================================================

export async function pluginSnapshot(): Promise<void> {
  const plugins = await scanAllPlugins();
  const { saveSnapshot } = await import('./plugin-snapshot.js');

  const snapshot = {
    scannedAt: new Date().toISOString(),
    plugins: Object.fromEntries(plugins.map(p => [p.name, { name: p.name, version: p.version, skills: p.skills, mcps: p.mcps, agents: p.agents }])),
  };

  await saveSnapshot(snapshot);
  console.log(`📸 Snapshot saved: ${plugins.length} plugins at ${snapshot.scannedAt.slice(0, 19)}\n`);
}

// ============================================================================
// Doctor Command — Orphan detection
// ============================================================================

export async function pluginDoctor(): Promise<void> {
  console.log('🩺 Plugin health check...\n');

  const plugins = await listPlugins();
  const { scanAllPlugins } = await import('./plugin-scanner.js');
  const scanResults = await scanAllPlugins();
  const scanNames = new Set(scanResults.map(p => p.name));
  const registryNames = new Set(plugins.map(p => p.name));

  let issues = 0;

  // 1. Registry entries without filesystem presence
  for (const p of plugins) {
    const dirs = [
      path.join(AGENT_PLUGIN_DIR.claude, p.name),
      path.join(AGENT_PLUGIN_DIR.codex, p.name),
      path.join(AGENT_PLUGIN_DIR.antigravity, p.name),
      getPluginInstallDir(p.name),
    ];
    let found = false;
    for (const d of dirs) {
      try { await fs.access(d); found = true; break; } catch {}
    }
    if (!found) {
      console.log(`  👻 Orphan registry: ${p.name} (no filesystem presence)`);
      issues++;
    }
  }

  // 2. Filesystem plugins without registry entries
  for (const name of scanNames) {
    if (!registryNames.has(name)) {
      console.log(`  📦 Unregistered: ${name} (on disk but not in registry)`);
      issues++;
    }
  }

  // 3. Check acm management dir for orphans
  const acmPluginDir = path.join(getCatalogDir(), 'plugins');
  try {
    const acmPlugins = await fs.readdir(acmPluginDir, { withFileTypes: true });
    for (const entry of acmPlugins) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!registryNames.has(entry.name)) {
        console.log(`  👻 Orphan acm dir: ${entry.name} (~/.acm/plugins/)`);
        issues++;
      }
    }
  } catch {}

  if (issues === 0) {
    console.log(`  ✅ All clean — no orphan plugins detected.\n`);
  } else {
    console.log(`\n  ${issues} issue(s) found.`);
    console.log(`  Run 'acm plugin install <name>' to register unregistered plugins.`);
    console.log(`  Run 'acm plugin uninstall <name>' to clean up orphans.\n`);
  }
}

// ============================================================================
// Import Command
// ============================================================================

/**
 * Read a plugin manifest, trying each provider's location.
 * The three formats differ only in where the file sits.
 */
async function readPluginManifest(dir: string): Promise<PluginManifest | null> {
  const candidates = [
    path.join(dir, '.claude-plugin', 'plugin.json'),
    path.join(dir, '.codex-plugin', 'plugin.json'),
    path.join(dir, 'plugin.json'),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf8')) as PluginManifest;
    } catch {
      continue;
    }
  }
  return null;
}

/** List the component names a plugin directory carries. */
async function inventoryPlugin(dir: string): Promise<{
  skills: string[];
  mcps: string[];
  agentFiles: string[];
  commandFiles: string[];
  knowledgeFiles: string[];
}> {
  const skills: string[] = [];
  try {
    for (const entry of await fs.readdir(path.join(dir, 'skills'), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        await fs.access(path.join(dir, 'skills', entry.name, 'SKILL.md'));
        skills.push(entry.name);
      } catch {
        // Not a skill directory.
      }
    }
  } catch {
    // No skills.
  }

  const mcps: string[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, '.mcp.json'), 'utf8'));
    mcps.push(...Object.keys(raw.mcpServers ?? {}));
  } catch {
    // No MCP definitions.
  }

  const listFiles = async (sub: string, filter: (name: string) => boolean): Promise<string[]> => {
    try {
      const entries = await fs.readdir(path.join(dir, sub), { withFileTypes: true });
      return entries.filter((e) => e.isFile() && filter(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  };

  const agentFiles = await listFiles('agents', (n) => n.endsWith('.md') || n.endsWith('.yaml'));
  const commandFiles = await listFiles('commands', (n) => n.endsWith('.md'));
  const knowledgeFiles = await listFiles('.', (n) => n.endsWith('.md') && n !== 'README.md');

  return { skills, mcps, agentFiles, commandFiles, knowledgeFiles };
}

/**
 * Take a plugin directory into the catalog.
 *
 * Without this, a plugin could only enter the catalog by being discovered in a
 * provider's own directory — so a plugin obtained any other way, or a catalog
 * starting from empty, had no way in at all.
 */
export async function pluginImport(sourcePath: string, options: { as?: string } = {}): Promise<void> {
  const { addPluginEntry, getPluginEntry, validatePluginName } = await import('./plugins-metadata.js');

  const source = path.resolve(sourcePath);

  // Some applications ship a bare `skills/` directory with no manifest at all —
  // VS Code's bundled prompts and Dia's are both like this. Discovery finds them
  // by their skills, so import has to accept them the same way; the caller
  // supplies the name the manifest would have given.
  const manifest = (await readPluginManifest(source)) ?? ({} as PluginManifest);
  const hasSkills = (await inventoryPlugin(source)).skills.length > 0;

  if (!manifest.name && !options.as && !hasSkills) {
    console.error(`No plugin manifest or skills found in ${source}`);
    console.error('Expected .claude-plugin/plugin.json, .codex-plugin/plugin.json or plugin.json');
    process.exitCode = 1;
    return;
  }

  const name = options.as ?? manifest.name ?? path.basename(source);
  try {
    validatePluginName(name);
  } catch (error) {
    console.error(`Invalid plugin name: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const destination = path.join(getCatalogDir(), 'plugins', name);
  const alreadyThere = path.resolve(destination) === source;

  if (!alreadyThere) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(source, destination, { recursive: true, dereference: true });
  }

  const inventory = await inventoryPlugin(destination);
  const existing = await getPluginEntry(name);

  // Record what the source looked like, so a later scan can tell whether the
  // application replaced it.
  const { digestSkillDir } = await import('./skill-placement.js');
  const { describeSource } = await import('./desktop-scanner.js');
  const sourceDigest = (await digestSkillDir(source)) ?? undefined;
  const origin = await describeSource(source);

  await addPluginEntry({
    name,
    version: manifest.version,
    description: manifest.description ?? manifest.interface?.shortDescription,
    author: manifest.author?.name,
    homepage: manifest.homepage,
    repository: manifest.repository,
    license: manifest.license,
    keywords: manifest.keywords,
    category: manifest.interface?.category,
    displayName: manifest.interface?.displayName,
    longDescription: manifest.interface?.longDescription,
    capabilities: manifest.interface?.capabilities,
    agent: existing?.agent ?? 'claude',
    installedFor: existing?.installedFor,
    sourcePath: source,
    ...inventory,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceDigest,
    sourceApp: origin.app,
    sourceAppVersion: origin.appVersion,
    reportedUpdatedAt: origin.reportedUpdatedAt,
    sourceMarketplace: origin.marketplace,
  });

  const parts = [
    `${inventory.skills.length} skill${inventory.skills.length === 1 ? '' : 's'}`,
    `${inventory.mcps.length} MCP server${inventory.mcps.length === 1 ? '' : 's'}`,
    `${inventory.agentFiles.length} agent file${inventory.agentFiles.length === 1 ? '' : 's'}`,
  ];
  console.log(`Imported into the catalog: ${name} (${parts.join(', ')})`);
  console.log(`\nRun \`acm plugin install ${name} -t <target>\` to install it.`);
}


// ============================================================================
// Cross-provider Conversion
// ============================================================================

/**
 * Make catalog plugins available to other providers.
 *
 * There is no format to translate between: the four providers differ only in
 * where they look for a manifest, so one assembled directory is read by all of
 * them. What they do not share is installation — a plugin is enabled state a
 * provider records, so each one's own CLI has to perform it. Both halves are
 * here: assemble a local marketplace, then hand it to each provider.
 */
export async function pluginConvert(argv: string[]): Promise<void> {
  const { buildMarketplace, registerMarketplace, installCommand, getMarketplaceDir } =
    await import('./plugin-marketplace.js');

  const targets = parseTargets(argv);
  const dryRun = parseFlag(argv, '--dry-run', '-n');
  const all = parseFlag(argv, '--all');
  const names = positionalArgs(argv, ['--target', '-t']);

  const catalog = await listPlugins();
  const chosen = all ? catalog : catalog.filter((p) => names.includes(p.name));

  if (chosen.length === 0) {
    console.error(all ? 'The catalog has no plugins.' : `Not in the catalog: ${names.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const destination = getMarketplaceDir();

  if (dryRun) {
    console.log(`Would assemble ${chosen.length} plugins into ${destination}`);
    console.log(`Would register that marketplace with: ${targets.join(', ')}\n`);
    for (const entry of chosen.slice(0, 10)) console.log(`  ${entry.name}`);
    if (chosen.length > 10) console.log(`  … and ${chosen.length - 10} more`);
    return;
  }

  console.log(`Assembling ${chosen.length} plugins into ${destination}...`);
  const built = await buildMarketplace(chosen, destination);

  let restored = 0;
  const problems: string[] = [];
  const ignored = new Map<string, Set<TargetName>>();

  for (const { entry, report } of built) {
    restored += report.skillsRestored.length;
    if (report.skillsMissing.length > 0) {
      problems.push(`${entry.name}: the catalog no longer holds ${report.skillsMissing.join(', ')}`);
    }
    // Name what a provider will not use, rather than letting it vanish quietly.
    for (const field of report.providerSpecific) {
      const losers = targets.filter((t) => !field.usedBy.includes(t));
      if (losers.length === 0) continue;
      const set = ignored.get(field.field) ?? new Set<TargetName>();
      losers.forEach((t) => set.add(t));
      ignored.set(field.field, set);
    }
  }

  console.log(`  ${built.length} plugins, ${restored} skill directories pulled from the catalog`);

  console.log('\nRegistering the marketplace:');
  for (const target of targets) {
    const result = await registerMarketplace(target, destination);
    if (!result) {
      // Antigravity has no marketplace command; it installs per plugin.
      console.log(`  [${target}] installs per plugin — see below`);
      continue;
    }
    console.log(`  [${target}] ${result.ok ? 'ok' : 'failed'}: ${result.command}`);
    if (!result.ok && result.output) console.log(`      ${result.output.split('\n')[0]}`);
  }

  console.log('\nInstall a plugin with:');
  const example = built[0]?.entry.name ?? '<name>';
  for (const target of targets) {
    console.log(`  [${target}] ${installCommand(target, example, destination)}`);
  }

  if (ignored.size > 0) {
    console.log('\nCarried but unused:');
    for (const [field, losers] of ignored) {
      console.log(`  \`${field}\` — ignored by ${[...losers].join(', ')}`);
    }
  }

  if (problems.length > 0) {
    console.log('\nNeeds attention:');
    for (const problem of problems) console.log(`  ${problem}`);
  }
}

// ============================================================================
// Payload Repair
// ============================================================================

/**
 * Restore skill files that an earlier import dropped.
 *
 * Reports by default; `--apply` performs the copies. Nothing is overwritten —
 * only files absent from the catalog are written — so a skill the user has
 * since edited keeps their version.
 */
export async function pluginRepair(options: { apply?: boolean } = {}): Promise<void> {
  const { findTruncatedSkills, restoreSkill } = await import('./plugin-payload.js');

  console.log('Comparing catalog skills against the plugins they came from...\n');
  const truncated = await findTruncatedSkills();

  if (truncated.length === 0) {
    console.log('Every catalog skill has all the files its source has.');
    return;
  }

  const byPlugin = new Map<string, typeof truncated>();
  for (const entry of truncated) {
    const list = byPlugin.get(entry.plugin) ?? [];
    list.push(entry);
    byPlugin.set(entry.plugin, list);
  }

  let totalFiles = 0;
  for (const [plugin, entries] of [...byPlugin].sort()) {
    const files = entries.reduce((sum, e) => sum + e.missing.length, 0);
    totalFiles += files;
    console.log(`${plugin}  (${entries.length} skills, ${files} files)`);
    for (const entry of entries) {
      console.log(`    ${entry.skill}: ${entry.missing.length} missing`);
    }
  }

  console.log();
  console.log(
    `${truncated.length} skills across ${byPlugin.size} plugins are missing ${totalFiles} files.`
  );

  if (!options.apply) {
    console.log('Run with --apply to restore them.');
    return;
  }

  console.log('\nRestoring...');
  let restored = 0;
  for (const entry of truncated) {
    restored += await restoreSkill(entry);
  }
  console.log(`Restored ${restored} files.`);
}

// ============================================================================
// Desktop Discovery
// ============================================================================

/**
 * Report plugins bundled inside desktop applications, and optionally take them
 * into the catalog.
 */
export async function pluginDiscover(options: { import?: boolean } = {}): Promise<void> {
  const formatHomePath = (p: string) =>
    p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
  const { scanDesktopPlugins } = await import('./desktop-scanner.js');
  const { getPluginEntry } = await import('./plugins-metadata.js');

  console.log('Searching desktop applications for bundled plugins...\n');
  const found = await scanDesktopPlugins();

  if (found.length === 0) {
    console.log('None found.');
    return;
  }

  // Generic names collide: Dia and Visual Studio Code both ship a plugin called
  // `prompts`, and importing them in turn would leave the catalog with whichever
  // came last. Only the ambiguous ones are qualified, so ordinary names stay as
  // the plugin itself declares them.
  const nameCounts = new Map<string, number>();
  for (const plugin of found) {
    nameCounts.set(plugin.name, (nameCounts.get(plugin.name) ?? 0) + 1);
  }
  const catalogNames = new Map<DesktopPlugin, string>();
  for (const plugin of found) {
    const ambiguous = (nameCounts.get(plugin.name) ?? 0) > 1;
    const prefix = plugin.app ? plugin.app.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'unknown';
    catalogNames.set(plugin, ambiguous ? `${prefix}-${plugin.name}` : plugin.name);
  }

  for (const plugin of found) {
    const catalogName = catalogNames.get(plugin)!;
    const known = await getPluginEntry(catalogName);
    const where = plugin.app ? `${plugin.app}${plugin.appVersion ? ` ${plugin.appVersion}` : ''}` : 'unknown app';
    const parts = [where];
    if (plugin.skills.length > 0) parts.push(`${plugin.skills.length} skills`);
    if (plugin.marketplace) parts.push(`from ${plugin.marketplace}`);
    if (plugin.reportedUpdatedAt) parts.push(`updated ${plugin.reportedUpdatedAt.slice(0, 10)}`);

    console.log(`${known ? '=' : '+'} ${catalogName}  (${parts.join(', ')})`);
    console.log(`    ${formatHomePath(plugin.sourcePath)}`);
  }

  const newcomers = [];
  for (const plugin of found) {
    if (!(await getPluginEntry(catalogNames.get(plugin)!))) newcomers.push(plugin);
  }

  console.log();
  console.log(`${found.length} found, ${newcomers.length} not in the catalog.`);

  if (!options.import) {
    if (newcomers.length > 0) {
      console.log('Run with --import to take them into the catalog.');
    }
    return;
  }

  for (const plugin of newcomers) {
    await pluginImport(plugin.sourcePath, { as: catalogNames.get(plugin)! });
  }
}
