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
import { getCatalogDir, fromPortablePath } from './acm-config.js';

const run = promisify(execFile);

export type DriftKind = 'skill' | 'mcp' | 'plugin';

export interface SourceDrift {
  kind: DriftKind;
  id: string;
  /** What changed, in one line. */
  detail: string;
}

/**
 * Pair a catalog plugin with the copy found on this machine.
 *
 * Name alone is not enough. A catalog name is not always the plugin's own: two
 * applications both ship one called `prompts`, so importing them qualified the
 * second as `visual-studio-code-prompts`, and `acm plugin import --as` can
 * rename anything. Matching on name meant those entries were reported as having
 * no source at all, so `acm plugin update` refused to touch them.
 *
 * A bundled plugin does move when its application updates, so the recorded path
 * is the fallback rather than the first try.
 */
export function matchDiscovered<T extends { name: string; sourcePath: string }>(
  plugin: { name: string; sourcePath: string },
  discovered: T[]
): T | undefined {
  const byName = discovered.find((candidate) => candidate.name === plugin.name);
  if (byName) return byName;

  const recorded = path.resolve(fromPortablePath(plugin.sourcePath));
  return discovered.find((candidate) => path.resolve(candidate.sourcePath) === recorded);
}

/**
 * Plugins whose bundled source no longer matches what was imported.
 *
 * A desktop application replaces its bundle wholesale on update, and the path
 * it lives at may change with it, so the comparison is by content: the digest
 * recorded at import versus the digest of the source now. The application's
 * version is reported alongside because it explains the change.
 *
 * A source that is simply *not on this machine* is not drift and is not
 * reported here. Once a catalog is shared between machines that is the normal
 * state for every application the second machine does not have — permanent, not
 * actionable, and reported under portability instead.
 */
export async function pluginSourceDrift(): Promise<SourceDrift[]> {
  const { listPlugins } = await import('./plugins-metadata.js');
  const { scanDesktopPlugins, digestPluginSource } = await import('./desktop-scanner.js');

  const plugins = await listPlugins();
  const tracked = plugins.filter((p) => p.sourceDigest);
  if (tracked.length === 0) return [];

  const discovered = await scanDesktopPlugins();

  const drift: SourceDrift[] = [];

  for (const plugin of tracked) {
    const current = matchDiscovered(plugin, discovered);
    const sourcePath = current?.sourcePath ?? fromPortablePath(plugin.sourcePath);

    const digest = await digestPluginSource(sourcePath);
    // Absent, not changed. Reported under portability.
    if (digest === null) continue;

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
