/**
 * Recovering skill payloads that a plugin import left behind.
 *
 * A skill is a directory. Earlier versions registered a plugin's skills by
 * reading SKILL.md alone, so every reference, script and asset beside it was
 * dropped — the instructions survived but the things they point at did not.
 *
 * The imports themselves are fixed, but the catalog still holds the truncated
 * copies. This module finds them by comparing the catalog against the plugin
 * directories the providers still hold, and copies back what is missing.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fromPortablePath } from './acm-config.js';

/** Provider directories that hold unpacked plugins, in preference order. */
function pluginRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.codex', '.tmp', 'plugins', 'plugins'),
    path.join(home, '.gemini', 'config', 'plugins'),
    path.join(home, '.grok', 'plugins'),
  ];
}

/** Every file in a directory tree, as paths relative to it. */
async function relativeFiles(dir: string): Promise<Set<string>> {
  const found = new Set<string>();

  async function walk(current: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else {
        found.add(rel);
      }
    }
  }

  await walk(dir, '');
  return found;
}

/** Where a plugin's skill still exists in full, or null when nowhere does. */
export async function findSkillSource(
  pluginName: string,
  skillId: string,
  recordedSourcePath?: string
): Promise<string | null> {
  const candidates = [
    ...(recordedSourcePath ? [path.join(recordedSourcePath, 'skills', skillId)] : []),
    ...pluginRoots().map((root) => path.join(root, pluginName, 'skills', skillId)),
  ];

  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/**
 * Plugins whose `.mcp.json` never reached the catalog.
 *
 * The same import dropped this for the same reason it dropped a skill's
 * references: the servers were registered in the catalog's MCP list, so the
 * file itself looked redundant. It is not — it is how a provider learns which
 * servers the plugin brings, and without it an installed plugin has none.
 */
export interface MissingMcpConfig {
  plugin: string;
  /** The copy this can be restored from. */
  source: string;
}

export async function findMissingMcpConfigs(): Promise<MissingMcpConfig[]> {
  const { listPlugins, getPluginInstallDir } = await import('./plugins-metadata.js');

  const missing: MissingMcpConfig[] = [];

  for (const plugin of await listPlugins()) {
    const catalogFile = path.join(getPluginInstallDir(plugin.name), '.mcp.json');
    if (await fs.stat(catalogFile).catch(() => null)) continue;

    const candidates = [
      ...(plugin.sourcePath ? [path.join(fromPortablePath(plugin.sourcePath), '.mcp.json')] : []),
      ...pluginRoots().map((root) => path.join(root, plugin.name, '.mcp.json')),
    ];

    for (const candidate of candidates) {
      if (await fs.stat(candidate).catch(() => null)) {
        missing.push({ plugin: plugin.name, source: candidate });
        break;
      }
    }
  }

  return missing;
}

export async function restoreMcpConfig(entry: MissingMcpConfig): Promise<void> {
  const { getPluginInstallDir } = await import('./plugins-metadata.js');
  const destination = path.join(getPluginInstallDir(entry.plugin), '.mcp.json');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(entry.source, destination, { dereference: true });
}

export interface TruncatedSkill {
  plugin: string;
  skill: string;
  /** The full copy this can be restored from. */
  source: string;
  /** Files present at the source but not in the catalog. */
  missing: string[];
}

/**
 * Catalog skills that are missing files their source still has.
 *
 * A skill linked to a working copy is skipped: the catalog entry is a symlink
 * to somewhere the user maintains by hand, and overwriting it would replace
 * their work with a bundled copy.
 */
export async function findTruncatedSkills(): Promise<TruncatedSkill[]> {
  const { listPlugins } = await import('./plugins-metadata.js');
  const { getSkillDir } = await import('./catalog.js');

  const truncated: TruncatedSkill[] = [];

  for (const plugin of await listPlugins()) {
    for (const skillId of plugin.skills ?? []) {
      const catalogDir = getSkillDir(skillId);

      const link = await fs.lstat(catalogDir).catch(() => null);
      if (!link || link.isSymbolicLink()) continue;

      const source = await findSkillSource(
        plugin.name,
        skillId,
        plugin.sourcePath ? fromPortablePath(plugin.sourcePath) : undefined
      );
      if (!source) continue;

      const have = await relativeFiles(catalogDir);
      const want = await relativeFiles(source);
      const missing = [...want].filter((file) => !have.has(file)).sort();

      if (missing.length > 0) {
        truncated.push({ plugin: plugin.name, skill: skillId, source, missing });
      }
    }
  }

  return truncated;
}

/**
 * Copy back the missing files.
 *
 * Only the missing paths are written. A file that exists in both places is
 * left alone, because the catalog copy may carry the user's own edits.
 */
export async function restoreSkill(entry: TruncatedSkill): Promise<number> {
  const { getSkillDir } = await import('./catalog.js');
  const catalogDir = getSkillDir(entry.skill);

  let restored = 0;
  for (const relative of entry.missing) {
    const from = path.join(entry.source, relative);
    const to = path.join(catalogDir, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { dereference: true });
    restored++;
  }
  return restored;
}
