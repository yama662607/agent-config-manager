/**
 * Plugin Snapshot — Change Detection
 *
 * Saves scan results to disk and compares with previous snapshots
 * to detect new, removed, and changed plugins.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { getCatalogDir } from './acm-config.js';

const SNAPSHOT_FILE = 'plugin-snapshot.toml';
const snapshotPath = () => path.join(getCatalogDir(), SNAPSHOT_FILE);

export interface PluginSnapshot {
  scannedAt: string;
  plugins: Record<string, { name: string; version?: string; skills: number; mcps: number; agents: number }>;
}

export async function saveSnapshot(snapshot: PluginSnapshot): Promise<void> {
  const dir = path.dirname(snapshotPath());
  await fs.mkdir(dir, { recursive: true });
  const tmp = snapshotPath() + '.tmp';
  await fs.writeFile(tmp, TOML.stringify(snapshot as any), 'utf8');
  await fs.rename(tmp, snapshotPath());
}

export async function loadSnapshot(): Promise<PluginSnapshot | null> {
  try {
    const raw = await fs.readFile(snapshotPath(), 'utf8');
    const parsed = TOML.parse(raw) as any;
    if (!parsed?.plugins) return null;
    return parsed as PluginSnapshot;
  } catch {
    return null;
  }
}

export interface PluginDiff {
  added: string[];
  removed: string[];
  changed: { name: string; field: string; before: string; after: string }[];
}

export function diffSnapshots(prev: PluginSnapshot | null, current: PluginSnapshot): PluginDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { name: string; field: string; before: string; after: string }[] = [];

  if (!prev) {
    added.push(...Object.keys(current.plugins));
    return { added, removed, changed };
  }

  const prevPlugins = prev.plugins;
  const currPlugins = current.plugins;

  for (const name of Object.keys(currPlugins)) {
    if (!prevPlugins[name]) {
      added.push(name);
    } else {
      const p = prevPlugins[name];
      const c = currPlugins[name];
      if (p.version !== c.version) changed.push({ name, field: 'version', before: p.version || '-', after: c.version || '-' });
      if (p.skills !== c.skills) changed.push({ name, field: 'skills', before: String(p.skills), after: String(c.skills) });
      if (p.mcps !== c.mcps) changed.push({ name, field: 'mcps', before: String(p.mcps), after: String(c.mcps) });
    }
  }
  for (const name of Object.keys(prevPlugins)) {
    if (!currPlugins[name]) removed.push(name);
  }

  return { added, removed, changed };
}
