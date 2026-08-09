/**
 * ACM directory resolution.
 *
 * Two directories, deliberately separate:
 *
 * - **State** (`~/.acm`): this tool's own files — config, lock, cache. Fixed.
 * - **Catalog**: the skills, MCP recipes and plugins themselves. Configurable,
 *   because the catalog is data a user may want to keep in a version-controlled
 *   repository somewhere else.
 *
 * Resolution order for the catalog: `ACM_CATALOG_DIR`, then `catalog_dir` in
 * `~/.acm/config.toml`, then the state directory itself (the historical layout,
 * where the catalog lives in `~/.acm` or is symlinked from there).
 *
 * Reading config synchronously keeps path resolution usable from the many
 * `getXPath()` helpers that are not async.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';

const STATE_DIR_NAME = '.acm';
const CONFIG_FILE = 'config.toml';

/** The tool's own state directory. Never configurable. */
export function getStateDir(): string {
  return path.join(os.homedir(), STATE_DIR_NAME);
}

export function getConfigPath(): string {
  return path.join(getStateDir(), CONFIG_FILE);
}

/** Expand a leading `~` so config files can use it. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Store a path so a catalog shared between machines does not churn.
 *
 * `/Users/<one user>/…` on one machine and `/Users/<another>/…` on the other is the
 * same location described twice, and every command that re-records one produces
 * a diff the other has to undo. Writing `~/…` makes the two agree.
 *
 * Paths outside the home directory — an application bundle, a volume — are left
 * alone: they are absolute facts about the machine, not about the user.
 */
export function toPortablePath(absolute: string): string {
  const home = os.homedir();
  if (absolute === home) return '~';
  if (absolute.startsWith(home + path.sep)) return '~/' + absolute.slice(home.length + 1);
  return absolute;
}

/** Resolve a stored path. Absolute paths from before this change still work. */
export function fromPortablePath(stored: string): string {
  return expandHome(stored);
}

function readCatalogDirFromConfig(): string | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = TOML.parse(raw) as { catalog_dir?: unknown };
    return typeof parsed.catalog_dir === 'string' && parsed.catalog_dir.length > 0
      ? parsed.catalog_dir
      : null;
  } catch {
    // Missing or unparsable config falls back to the default.
    return null;
  }
}

/** Where skills, MCP recipes and plugins live. */
export function getCatalogDir(): string {
  const fromEnv = process.env.ACM_CATALOG_DIR;
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(expandHome(fromEnv));
  }

  const fromConfig = readCatalogDirFromConfig();
  if (fromConfig) {
    return path.resolve(expandHome(fromConfig));
  }

  return getStateDir();
}

/** How the catalog directory was chosen. Shown by `acm doctor`. */
export function describeCatalogSource(): 'env' | 'config' | 'default' {
  if (process.env.ACM_CATALOG_DIR) return 'env';
  if (readCatalogDirFromConfig()) return 'config';
  return 'default';
}

/**
 * Targets used when a command does not name any.
 * Configured as `default_targets = ["claude", "codex"]` in config.toml.
 */
export function getDefaultTargets(): string[] | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = TOML.parse(raw) as { default_targets?: unknown };
    if (Array.isArray(parsed.default_targets) && parsed.default_targets.length > 0) {
      return parsed.default_targets.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    // Fall through to the built-in default.
  }
  return null;
}
