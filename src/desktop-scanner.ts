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

/**
 * Where to look, and how deep.
 *
 * An application bundle is mostly frameworks and compiled code; only
 * `Contents/Resources` holds shipped content, so the rest is never walked.
 * The depths come from the deepest layout observed in practice — an app's
 * `Resources/plugins/<marketplace>/plugins/<name>` and Claude Desktop's
 * `<app>/local-agent-mode-sessions/<uuid>/<uuid>/rpm/<plugin>` — plus one level
 * of headroom. Walking further multiplies cost without finding anything: at
 * depth 9 the search visited 119,000 directories, at these depths it visits a
 * fraction of that.
 */
interface SearchRoot {
  dir: string;
  depth: number;
}

async function searchRoots(): Promise<SearchRoot[]> {
  const home = os.homedir();
  const roots: SearchRoot[] = [];

  for (const applications of ['/Applications', path.join(home, 'Applications')]) {
    let entries;
    try {
      entries = await fs.readdir(applications, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith('.app')) continue;

      const resources = path.join(applications, entry.name, 'Contents', 'Resources');
      if (await looksLikeAgentApp(resources)) {
        roots.push({ dir: resources, depth: 7 });
      }
    }
  }

  roots.push({ dir: path.join(home, 'Library', 'Application Support'), depth: 7 });
  return roots;
}

/**
 * Whether an application ships anything an agent would use.
 *
 * Checked one level down, before walking: most applications are not agent
 * tooling at all, and two audio applications alone accounted for 24,000
 * directories of the search. A bundle qualifies when its resources mention
 * plugins, skills, agents or prompts near the top.
 */
async function looksLikeAgentApp(resources: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(resources, { withFileTypes: true });
  } catch {
    return false;
  }

  const interesting = /^(plugins?|skills?|agents?|prompts?|bundled|app|.*-resources)$/i;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (interesting.test(entry.name)) return true;
  }

  return false;
}

/** Directory names that never contain agent content and are expensive to walk. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'Frameworks',
  'MacOS',
  '_CodeSignature',
  'PlugIns',
  'locales',
  'fonts',
  'images',
  'icons',
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
  /** Marketplace the application installed it from, when it records one. */
  marketplace?: string;
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
 * What the application says about a plugin, rather than what the plugin says
 * about itself.
 *
 * Claude Desktop keeps this in a `manifest.json`, in one of two shapes. A
 * plugin the application manages directly carries its own, with `lastUpdated`
 * as epoch milliseconds. A plugin installed from a marketplace sits in a
 * directory named after an opaque id — `plugin_01KmRf…` — and the manifest one
 * level up lists every such id with a name and an update time. Without that
 * outer file the directory name is the only name available, and it says
 * nothing.
 */
async function applicationRecord(
  dir: string
): Promise<{ name?: string; updatedAt?: string; marketplace?: string }> {
  const own = await readJson(path.join(dir, 'manifest.json'));
  const lastUpdated = own?.lastUpdated;
  if (typeof lastUpdated === 'number') return { updatedAt: new Date(lastUpdated).toISOString() };
  if (typeof lastUpdated === 'string') return { updatedAt: lastUpdated };

  const parent = await readJson(path.join(dir, '..', 'manifest.json'));
  const id = path.basename(dir);
  const listed = (parent?.plugins as any[] | undefined)?.find((p) => p?.id === id);
  if (!listed) return {};

  return {
    name: listed.name,
    updatedAt: typeof listed.updatedAt === 'string' ? listed.updatedAt : undefined,
    marketplace: listed.marketplaceName,
  };
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
  const record = await applicationRecord(dir);

  return {
    name: manifest?.name ?? record.name ?? path.basename(dir),
    sourcePath: dir,
    app,
    appVersion,
    version: manifest?.version,
    description: manifest?.description ?? manifest?.interface?.shortDescription,
    skills,
    reportedUpdatedAt: record.updatedAt,
    marketplace: record.marketplace,
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
export async function scanDesktopPlugins(): Promise<DesktopPlugin[]> {
  const found: DesktopPlugin[] = [];

  for (const root of await searchRoots()) {
    await walk(root.dir, root.depth, found);
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Attribute a directory to an application, for recording where a plugin came from. */
export async function describeSource(dir: string): Promise<{
  app?: string;
  appVersion?: string;
  reportedUpdatedAt?: string;
  marketplace?: string;
}> {
  const { app, appVersion } = await attributeApp(dir);
  const record = await applicationRecord(dir);
  return { app, appVersion, reportedUpdatedAt: record.updatedAt, marketplace: record.marketplace };
}
