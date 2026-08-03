/**
 * What changed since the catalog last agreed with the world.
 *
 * Two independent questions, answered separately because the fixes differ:
 *
 * 1. **The source moved.** An upstream repository gained commits, or a desktop
 *    application replaced a bundled plugin. The catalog is behind and can be
 *    refreshed from the source.
 * 2. **The catalog moved.** Files in the catalog differ from its last commit.
 *    That is the user's own work, and it needs committing, not refreshing.
 *
 * Neither answer touches the network unless asked: application sources are on
 * disk, and the git comparison is local.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { getCatalogDir } from './acm-config.js';

const run = promisify(execFile);

export type DriftKind = 'skill' | 'mcp' | 'plugin';

export interface SourceDrift {
  kind: DriftKind;
  id: string;
  /** What changed, in one line. */
  detail: string;
}

/**
 * Plugins whose bundled source no longer matches what was imported.
 *
 * A desktop application replaces its bundle wholesale on update, and the path
 * it lives at may change with it, so the comparison is by content: the digest
 * recorded at import versus the digest of the source now. The application's
 * version is reported alongside because it explains the change.
 */
export async function pluginSourceDrift(): Promise<SourceDrift[]> {
  const { listPlugins } = await import('./plugins-metadata.js');
  const { digestSkillDir } = await import('./skill-placement.js');
  const { scanDesktopPlugins } = await import('./desktop-scanner.js');

  const plugins = await listPlugins();
  const tracked = plugins.filter((p) => p.sourceDigest);
  if (tracked.length === 0) return [];

  // A bundled plugin moves when its application updates, so it is located by
  // name rather than by the path recorded at import.
  const discovered = new Map((await scanDesktopPlugins()).map((p) => [p.name, p]));

  const drift: SourceDrift[] = [];

  for (const plugin of tracked) {
    const current = discovered.get(plugin.name);
    const sourcePath = current?.sourcePath ?? plugin.sourcePath;

    const digest = await digestSkillDir(sourcePath);
    if (digest === null) {
      drift.push({
        kind: 'plugin',
        id: plugin.name,
        detail: `source is gone (${plugin.sourceApp ?? 'unknown app'})`,
      });
      continue;
    }

    if (digest === plugin.sourceDigest) continue;

    const versionChange =
      current?.appVersion && plugin.sourceAppVersion && current.appVersion !== plugin.sourceAppVersion
        ? `${plugin.sourceApp} ${plugin.sourceAppVersion} -> ${current.appVersion}`
        : (current?.app ?? plugin.sourceApp ?? 'source');

    drift.push({ kind: 'plugin', id: plugin.name, detail: `changed in ${versionChange}` });
  }

  return drift;
}

/** Catalog entries whose files differ from the catalog's last commit. */
export interface GitDrift {
  /** Path relative to the catalog. */
  file: string;
  /** Git's own status letters, e.g. `M`, `??`. */
  status: string;
}

/**
 * Uncommitted changes in the catalog.
 *
 * Returns null when the catalog is not a git repository — that is a legitimate
 * setup, not a problem to report.
 */
export async function catalogGitDrift(): Promise<GitDrift[] | null> {
  const catalog = getCatalogDir();

  try {
    await run('git', ['-C', catalog, 'rev-parse', '--git-dir'], { timeout: 15_000 });
  } catch {
    return null;
  }

  const { stdout } = await run('git', ['-C', catalog, 'status', '--porcelain'], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) }));
}

/** Group changed files by the catalog area they belong to. */
export function summarizeGitDrift(entries: GitDrift[]): Map<string, number> {
  const areas = new Map<string, number>();

  for (const entry of entries) {
    const top = entry.file.split(path.sep)[0];
    const area =
      top === 'skills' || top === 'plugins' || top === 'mcp-servers' ? top : 'other files';
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }

  return areas;
}
