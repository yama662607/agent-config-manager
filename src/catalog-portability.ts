/**
 * What in the catalog only works on the machine that wrote it.
 *
 * A catalog is meant to be carried — cloned onto a second machine, or restored
 * after a rebuild. Most of it travels: a skill's files, an MCP recipe that runs
 * `npx -y <package>`. Some of it does not. A skill can be a symlink into a
 * development repository, and a recipe can name a binary, a checkout or a vault
 * by absolute path.
 *
 * Those are legitimate — the double-symlink layout is deliberate — so this does
 * not object to them. It lists them, and says which are present here. On the
 * machine that wrote them the answer is "all of them", which is a useful thing
 * to know before moving; elsewhere the list is the work to do.
 *
 * The check is local and cheap: a stat per path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export type ReferenceKind =
  | 'skill link'
  | 'command'
  | 'argument'
  | 'environment'
  | 'plugin source';

export interface MachineReference {
  kind: ReferenceKind;
  /** The catalog entry that carries it. */
  id: string;
  /** The absolute path referred to. */
  target: string;
  /** Which environment variable, for `environment` references. */
  variable?: string;
  /** Whether it is present on this machine. */
  present: boolean;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Skills stored as a symlink to somewhere outside the catalog. */
async function skillLinks(catalogDir: string): Promise<MachineReference[]> {
  const skillsDir = path.join(catalogDir, 'skills');

  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: MachineReference[] = [];

  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;

    const link = path.join(skillsDir, entry.name);
    const target = path.resolve(path.dirname(link), await fs.readlink(link));

    // A link that stays inside the catalog travels with it.
    if (target.startsWith(path.resolve(catalogDir) + path.sep)) continue;

    found.push({
      kind: 'skill link',
      id: entry.name,
      target,
      present: await exists(target),
    });
  }

  return found;
}

/** Absolute paths named by an MCP recipe. */
async function recipePaths(): Promise<MachineReference[]> {
  const { listMcps } = await import('./catalog.js');

  const found: MachineReference[] = [];

  for (const entry of await listMcps()) {
    const { command, args, env } = entry.recipe;

    const candidates: { kind: ReferenceKind; target: string; variable?: string }[] = [];

    if (command?.startsWith('/')) candidates.push({ kind: 'command', target: command });
    for (const arg of args ?? []) {
      if (arg.startsWith('/')) candidates.push({ kind: 'argument', target: arg });
    }
    for (const [variable, value] of Object.entries(env ?? {})) {
      if (typeof value === 'string' && value.startsWith('/')) {
        candidates.push({ kind: 'environment', target: value, variable });
      }
    }

    for (const candidate of candidates) {
      found.push({ ...candidate, id: entry.id, present: await exists(candidate.target) });
    }
  }

  return found;
}

/**
 * Applications a plugin was imported from.
 *
 * Once a catalog is shared, the second machine will not have every application
 * the first one had — Warp, Dia, ChatGPT. That is a permanent, unremarkable
 * fact about the machine, so it belongs here rather than in drift, where it
 * would be reported as a change forever and never go away.
 *
 * Located by name first, because an application update moves the directory.
 */
async function pluginSources(): Promise<MachineReference[]> {
  const { listPlugins } = await import('./plugins-metadata.js');
  const { scanDesktopPlugins } = await import('./desktop-scanner.js');
  const { fromPortablePath } = await import('./acm-config.js');

  const tracked = (await listPlugins()).filter((plugin) => plugin.sourceDigest);
  if (tracked.length === 0) return [];

  const discovered = new Map((await scanDesktopPlugins()).map((p) => [p.name, p]));

  const found: MachineReference[] = [];

  for (const plugin of tracked) {
    const here = discovered.get(plugin.name);
    const target = here?.sourcePath ?? fromPortablePath(plugin.sourcePath);

    found.push({
      kind: 'plugin source',
      id: plugin.name,
      target,
      variable: plugin.sourceApp,
      present: here !== undefined || (await exists(target)),
    });
  }

  return found;
}

/**
 * Everything in the catalog that names a location on this machine.
 *
 * Sorted with the missing ones first, because those are the ones to act on.
 */
export async function machineReferences(catalogDir: string): Promise<MachineReference[]> {
  const found = [
    ...(await skillLinks(catalogDir)),
    ...(await recipePaths()),
    ...(await pluginSources()),
  ];

  return found.sort((a, b) => {
    if (a.present !== b.present) return a.present ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}
