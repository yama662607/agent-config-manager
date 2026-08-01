/**
 * Catalog publishing.
 *
 * A personal catalog holds far more than should ever be public, so publishing is
 * opt-in: only entries named in an allowlist file are staged, and the staged
 * result is scanned for secrets and personal paths before it can be written
 * anywhere. Nothing is committed or pushed unless explicitly requested.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCatalogDir } from './acm-config.js';

/** Default allowlist filename inside the catalog. */
const ALLOWLIST_FILE = 'PUBLIC.txt';

/** Build artifacts and development-only content never belong in a public bundle. */
const EXCLUDED_NAMES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'browser_data',
  'tests',
  'evals',
  'pytest.ini',
  'VERIFICATION.md',
]);

const EXCLUDED_SUFFIXES = ['.pyc', '.log'];

/** Values that must never reach a public repository. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9]{20,}/, 'API key'],
  [/ghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/npm_[A-Za-z0-9]{30,}/, 'npm token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/_authToken/, 'registry auth token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];

/** Personal paths are not secrets, but they leak the owner's machine layout. */
const PERSONAL_PATH = /\/(Users|home)\/(?!username\b)[A-Za-z0-9._-]+/;

export interface CatalogPublishOptions {
  /** Allowlist path. Defaults to PUBLIC.txt in the catalog. */
  allowlist?: string;
  /** Public repository working tree to sync into. */
  to?: string;
  /** Commit and push the destination afterwards. */
  commit?: boolean;
  /** Report what would happen without writing to the destination. */
  dryRun?: boolean;
}

interface AllowlistEntry {
  kind: 'skill' | 'mcp' | 'plugin';
  name: string;
}

function formatHome(absolutePath: string): string {
  const home = os.homedir();
  return absolutePath === home || absolutePath.startsWith(home + '/')
    ? '~' + absolutePath.slice(home.length)
    : absolutePath;
}

async function readAllowlist(file: string): Promise<AllowlistEntry[]> {
  const raw = await fs.readFile(file, 'utf8');
  const entries: AllowlistEntry[] = [];

  for (const line of raw.split('\n')) {
    const text = line.split('#')[0].trim();
    if (!text) continue;

    const slash = text.indexOf('/');
    if (slash < 0) {
      throw new Error(`Malformed allowlist line (expected <kind>/<name>): ${text}`);
    }

    const kind = text.slice(0, slash);
    const name = text.slice(slash + 1).trim();
    if (kind !== 'skill' && kind !== 'mcp' && kind !== 'plugin') {
      throw new Error(`Unknown kind in allowlist: ${kind}`);
    }
    entries.push({ kind, name });
  }

  return entries;
}

/** Copy a directory, dropping development-only content. */
async function copyFiltered(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);

    // Resolve links: the published bundle must stand alone.
    const stat = await fs.stat(from).catch(() => null);
    if (!stat) continue;

    if (stat.isDirectory()) {
      await copyFiltered(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

interface ScanResult {
  secrets: string[];
  personalPaths: string[];
}

async function scanStaging(stage: string): Promise<ScanResult> {
  const secrets: string[] = [];
  const personalPaths: string[] = [];

  for await (const file of walkFiles(stage)) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue; // Binary or unreadable
    }

    const relative = path.relative(stage, file);
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(content)) secrets.push(`${relative}: ${label}`);
    }
    if (PERSONAL_PATH.test(content)) personalPaths.push(relative);
  }

  return { secrets, personalPaths };
}

/**
 * Stage the allowlisted subset of the catalog, and optionally sync it into a
 * public repository working tree.
 */
export async function catalogPublish(options: CatalogPublishOptions): Promise<void> {
  const catalogDir = getCatalogDir();
  const allowlistPath = options.allowlist
    ? path.resolve(options.allowlist)
    : path.join(catalogDir, ALLOWLIST_FILE);

  let entries: AllowlistEntry[];
  try {
    entries = await readAllowlist(allowlistPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Cannot read the allowlist at ${formatHome(allowlistPath)}: ${message}\n`);
    console.error('Publishing is opt-in: list what may be published as <kind>/<name> lines.');
    process.exitCode = 1;
    return;
  }

  if (entries.length === 0) {
    console.log('The allowlist is empty. Nothing to publish.');
    return;
  }

  const stage = path.join(catalogDir, 'dist-public');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  let staged = 0;
  const missing: string[] = [];

  for (const entry of entries) {
    if (entry.kind === 'mcp') {
      const source = path.join(catalogDir, 'mcp-servers', `${entry.name}.toml`);
      try {
        await fs.mkdir(path.join(stage, 'mcp'), { recursive: true });
        await fs.copyFile(source, path.join(stage, 'mcp', `${entry.name}.toml`));
        staged++;
      } catch {
        missing.push(`mcp/${entry.name}`);
      }
      continue;
    }

    const dirName = entry.kind === 'skill' ? 'skills' : 'plugins';
    const source = path.join(catalogDir, dirName, entry.name);
    try {
      await fs.access(source);
      await copyFiltered(source, path.join(stage, dirName, entry.name));
      staged++;
    } catch {
      missing.push(`${entry.kind}/${entry.name}`);
    }
  }

  // Overlay: files the bundle needs but the catalog does not contain as entries
  // (README, LICENSE, .gitignore, setup docs). Copied verbatim over the staging
  // root, so the layout is entirely the user's choice.
  const overlay = path.join(catalogDir, 'publish', 'bundle');
  let overlaid = 0;
  try {
    await fs.access(overlay);
    await copyFiltered(overlay, stage);
    for await (const _ of walkFiles(overlay)) overlaid++;
  } catch {
    // No overlay configured.
  }

  console.log(`Staged ${staged} of ${entries.length} allowlisted entries in ${formatHome(stage)}`);
  if (overlaid > 0) {
    console.log(`Applied ${overlaid} overlay file${overlaid === 1 ? '' : 's'} from publish/bundle/`);
  }
  for (const item of missing) {
    console.error(`  ! not found in the catalog: ${item}`);
  }

  const scan = await scanStaging(stage);

  if (scan.secrets.length > 0) {
    console.error('\nPublishing stopped: possible secrets in the staged bundle.');
    for (const hit of scan.secrets) console.error(`  ${hit}`);
    process.exitCode = 1;
    return;
  }

  if (scan.personalPaths.length > 0) {
    console.error('\nPublishing stopped: personal paths in the staged bundle.');
    for (const hit of scan.personalPaths) console.error(`  ${hit}`);
    console.error('Rewrite them, or exclude the entry from the allowlist.');
    process.exitCode = 1;
    return;
  }

  console.log('✓ No secrets or personal paths in the staged bundle');

  if (!options.to) {
    console.log('\nPass --to <public-repo> to sync this bundle into a repository.');
    return;
  }

  const destination = path.resolve(options.to);
  try {
    await fs.access(path.join(destination, '.git'));
  } catch {
    console.error(`\nNot a git working tree: ${formatHome(destination)}`);
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(`\nDry run: would sync ${staged} entries into ${formatHome(destination)}`);
    return;
  }

  // Replace tracked content, but never touch the destination's own git data.
  for (const entry of await fs.readdir(destination)) {
    if (entry === '.git') continue;
    await fs.rm(path.join(destination, entry), { recursive: true, force: true });
  }
  await copyFiltered(stage, destination);

  console.log(`\nSynced into ${formatHome(destination)}`);

  if (!options.commit) {
    console.log('Review the changes there, then commit and push.');
    return;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  await run('git', ['add', '-A'], { cwd: destination });
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: destination });
  if (!stdout.trim()) {
    console.log('No changes to commit.');
    return;
  }

  await run('git', ['commit', '-m', `publish: sync ${staged} allowlisted entries`], {
    cwd: destination,
  });
  console.log('Committed. Push when ready.');
}
