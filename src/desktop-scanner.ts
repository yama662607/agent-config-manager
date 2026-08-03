/**
 * Plugins shipped inside desktop applications.
 *
 * The most current agent tooling is often not in a user-facing directory at
 * all: it is bundled inside an application and replaced whenever that
 * application updates. Those copies are worth tracking, but their paths are not
 * stable — Claude Desktop nests them under two session UUIDs, and an app bundle
 * is replaced wholesale on update.
 *
 * So nothing here hardcodes a path beyond the roots to search. A plugin is
 * anything that carries a recognisable manifest or a `skills/` directory, and
 * it is identified by content rather than location.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginManifest } from './types.js';

const run = promisify(execFile);

/** Where applications keep bundled agent content. */
function searchRoots(): string[] {
  const home = os.homedir();
  return [
    '/Applications',
    path.join(home, 'Applications'),
    path.join(home, 'Library', 'Application Support'),
  ];
}

/** Directory names that never contain agent content and are expensive to walk. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'Cache',
  'Caches',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Crashpad',
  'Service Worker',
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'WebStorage',
  'Partitions',
  'logs',
  'log',
  '.git',
]);

/** Hidden directories that carry a plugin manifest. */
const MANIFEST_DIRECTORIES = new Set(['.claude-plugin', '.codex-plugin']);

const MANIFEST_LOCATIONS = [
  path.join('.claude-plugin', 'plugin.json'),
  path.join('.codex-plugin', 'plugin.json'),
  'plugin.json',
];

export interface DesktopPlugin {
  /** Name from the manifest, or the directory name when there is none. */
  name: string;
  /** Absolute path of the plugin directory. */
  sourcePath: string;
  /** Which application it was found in, when that can be determined. */
  app?: string;
  /** Version of that application, so a bundled copy can be attributed. */
  appVersion?: string;
  /** Version from the plugin's own manifest. */
  version?: string;
  description?: string;
  /** Skill directory names inside the plugin. */
  skills: string[];
  /** Update time the plugin records about itself, when it does. */
  reportedUpdatedAt?: string;
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The application a path belongs to, and its version. */
async function attributeApp(dir: string): Promise<{ app?: string; appVersion?: string }> {
  const bundle = dir.match(/^(.*?\/([^/]+)\.app)\//);
  if (bundle) {
    const [, bundlePath, appName] = bundle;
    try {
      const { stdout } = await run(
        'defaults',
        ['read', path.join(bundlePath, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'],
        { timeout: 10_000 }
      );
      return { app: appName, appVersion: stdout.trim() };
    } catch {
      return { app: appName };
    }
  }

  // Application Support/<App>/…
  const support = dir.match(/Application Support\/([^/]+)\//);
  if (support) {
    const appName = support[1];
    try {
      const { stdout } = await run(
        'defaults',
        ['read', `/Applications/${appName}.app/Contents/Info.plist`, 'CFBundleShortVersionString'],
        { timeout: 10_000 }
      );
      return { app: appName, appVersion: stdout.trim() };
    } catch {
      return { app: appName };
    }
  }

  return {};
}

/** Skill directory names directly inside a plugin. */
async function listSkillNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for (const entry of await fs.readdir(path.join(dir, 'skills'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.access(path.join(dir, 'skills', entry.name, 'SKILL.md'));
        names.push(entry.name);
      } catch {
        // Not a skill.
      }
    }
  } catch {
    // No skills directory.
  }
  return names;
}

/**
 * An update time the plugin states about itself.
 * Claude Desktop writes one into `manifest.json` as epoch milliseconds.
 */
async function reportedUpdate(dir: string): Promise<string | undefined> {
  const manifest = await readJson(path.join(dir, 'manifest.json'));
  const value = manifest?.lastUpdated;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

/** Inspect one directory. Returns null when it is not a plugin. */
async function inspect(dir: string): Promise<DesktopPlugin | null> {
  let manifest: PluginManifest | null = null;
  for (const location of MANIFEST_LOCATIONS) {
    manifest = await readJson(path.join(dir, location));
    if (manifest?.name) break;
    manifest = null;
  }

  const skills = await listSkillNames(dir);

  // A directory with neither a manifest nor skills is not a plugin.
  if (!manifest && skills.length === 0) return null;

  const { app, appVersion } = await attributeApp(dir);

  return {
    name: manifest?.name ?? path.basename(dir),
    sourcePath: dir,
    app,
    appVersion,
    version: manifest?.version,
    description: manifest?.description ?? manifest?.interface?.shortDescription,
    skills,
    reportedUpdatedAt: await reportedUpdate(dir),
  };
}

/**
 * Walk for plugin directories.
 *
 * `maxDepth` is bounded because these trees contain large caches. The deepest
 * known layout is eight levels below a search root — an application bundle's
 * `Contents/Resources/plugins/<marketplace>/plugins/<plugin>` — and Claude
 * Desktop adds two UUID levels of its own.
 */
async function walk(dir: string, depth: number, found: DesktopPlugin[]): Promise<void> {
  if (depth <= 0) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Unreadable, or not a directory.
  }

  const plugin = await inspect(dir);
  if (plugin) {
    found.push(plugin);
    return; // Plugins do not nest.
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue;
    // Manifest directories are hidden; everything else hidden is noise.
    if (entry.name.startsWith('.') && !MANIFEST_DIRECTORIES.has(entry.name)) continue;
    await walk(path.join(dir, entry.name), depth - 1, found);
  }
}

/** Find plugins bundled inside desktop applications. */
export async function scanDesktopPlugins(maxDepth = 9): Promise<DesktopPlugin[]> {
  const found: DesktopPlugin[] = [];

  for (const root of searchRoots()) {
    await walk(root, maxDepth, found);
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Attribute a directory to an application, for recording where a plugin came from. */
export async function describeSource(dir: string): Promise<{
  app?: string;
  appVersion?: string;
  reportedUpdatedAt?: string;
}> {
  const { app, appVersion } = await attributeApp(dir);
  return { app, appVersion, reportedUpdatedAt: await reportedUpdate(dir) };
}
