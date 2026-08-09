/**
 * Making one plugin directory that every provider accepts.
 *
 * The four providers agree on the layout — `skills/`, `commands/`, `agents/`,
 * `hooks/hooks.json`, `.mcp.json` — and disagree only on where the manifest
 * sits. Claude looks in `.claude-plugin/`, Codex in `.codex-plugin/`, Grok in
 * `.grok-plugin/` or any of the others, Antigravity at the root.
 *
 * So there is nothing to convert. Writing the same manifest to all four
 * locations produces a directory each provider reads as its own, and each one
 * then applies its own handling: Antigravity turns `commands/` into skills by
 * itself, Claude ignores the fields it does not know. Verified with
 * `claude plugin validate`, `grok plugin validate` and `agy plugin validate`
 * against an assembled copy of the `zoom` plugin.
 *
 * The one thing that does need doing is putting the skills back. The catalog
 * stores a plugin's skills alongside every other skill, in `skills/<id>`, so
 * the plugin directory itself has none.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { PluginEntry, TargetName } from './types.js';

/** Every place a provider looks for a plugin manifest. */
const MANIFEST_LOCATIONS = [
  path.join('.claude-plugin', 'plugin.json'),
  path.join('.codex-plugin', 'plugin.json'),
  path.join('.grok-plugin', 'plugin.json'),
  'plugin.json',
];

/**
 * Fields a provider reads but its peers do not.
 *
 * Nothing is stripped — every provider ignores what it does not recognise, and
 * dropping a field would lose it on the way back. They are listed so a convert
 * can say what will not carry over rather than letting it disappear quietly.
 */
const PROVIDER_SPECIFIC: { field: string; usedBy: TargetName[]; what: string }[] = [
  { field: 'apps', usedBy: ['claude', 'codex'], what: 'connector app ids' },
  { field: 'interface', usedBy: ['codex'], what: 'store listing metadata' },
];

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** The plugin's manifest, from whichever provider's location holds it. */
export async function readManifest(pluginDir: string): Promise<any | null> {
  for (const location of MANIFEST_LOCATIONS) {
    const manifest = await readJson(path.join(pluginDir, location));
    if (manifest?.name) return manifest;
  }
  return null;
}

export interface AssemblyReport {
  /** Skills copied back in from the catalog. */
  skillsRestored: string[];
  /** Skills the entry declares that the catalog no longer holds. */
  skillsMissing: string[];
  /** Manifest fields only some providers will read. */
  providerSpecific: { field: string; usedBy: TargetName[]; what: string }[];
}

/**
 * Build a complete, provider-neutral copy of a catalog plugin at `destination`.
 *
 * The destination is replaced, not merged: an assembly is derived output and
 * anything already there is a previous run of this same function.
 */
export async function assemblePlugin(
  entry: PluginEntry,
  sourceDir: string,
  destination: string
): Promise<AssemblyReport> {
  const { getSkillDir } = await import('./catalog.js');

  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(sourceDir, destination, { recursive: true, dereference: true });

  const skillsRestored: string[] = [];
  const skillsMissing: string[] = [];

  for (const id of entry.skills ?? []) {
    const target = path.join(destination, 'skills', id);
    if (await isDirectory(target)) continue;

    const catalogSkill = getSkillDir(id);
    if (!(await isDirectory(catalogSkill))) {
      skillsMissing.push(id);
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(catalogSkill, target, { recursive: true, dereference: true });
    skillsRestored.push(id);
  }

  // The one place the providers genuinely differ on content rather than
  // filename. Claude, Codex and Grok read a plugin's servers from `.mcp.json`;
  // Antigravity reads `mcp_config.json` and ignores the other name. Probed by
  // running `agy plugin validate` against each candidate: `.mcp.json` and an
  // inlined `mcpServers` in the manifest both report "skipped (not found)",
  // while `mcp_config.json` reports "1 processed".
  const mcp = await readJson(path.join(destination, '.mcp.json'));
  if (mcp) {
    await fs.writeFile(
      path.join(destination, 'mcp_config.json'),
      JSON.stringify(mcp, null, 2) + '\n',
      'utf8'
    );
  }

  const manifest = (await readManifest(destination)) ?? { name: entry.name };
  // acm's own bookkeeping belongs in the catalog, not in what a provider loads.
  delete manifest.installedFor;
  delete manifest.installedAt;
  delete manifest.sourceAgent;

  for (const location of MANIFEST_LOCATIONS) {
    const file = path.join(destination, location);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  return {
    skillsRestored,
    skillsMissing,
    providerSpecific: PROVIDER_SPECIFIC.filter((f) => manifest[f.field] !== undefined),
  };
}
