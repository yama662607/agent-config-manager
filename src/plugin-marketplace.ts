/**
 * Publishing the catalog as a local marketplace.
 *
 * Every provider can add a marketplace from a local path, and every provider
 * then installs from it with its own CLI — which is what the rule in
 * docs/provider-config-surfaces.md asks for, because an installed plugin is
 * runtime state the provider records and enables, not a file it merely reads.
 * Dropping a directory into `~/.grok/plugins/` does produce a valid plugin, and
 * `grok plugin list` still shows nothing; the install has to go through the CLI.
 *
 * The marketplace index differs per provider only in filename and in how a
 * plugin's source is spelled, so all three are written side by side. The plugin
 * directories underneath are shared: see plugin-assemble.ts for why one
 * directory suffices for all four.
 *
 * Antigravity has no marketplace command. It installs a plugin from a local
 * path directly, so it is pointed at the same directories.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginEntry, TargetName } from './types.js';
import { getCatalogDir } from './acm-config.js';
import { assemblePlugin, type AssemblyReport } from './plugin-assemble.js';
import { getPluginInstallDir } from './plugins-metadata.js';

const run = promisify(execFile);

export const MARKETPLACE_NAME = 'acm-catalog';

/** Where the generated marketplace lives. Derived output, safe to rebuild. */
export function getMarketplaceDir(): string {
  return path.join(getCatalogDir(), 'marketplace');
}

export interface BuiltPlugin {
  entry: PluginEntry;
  report: AssemblyReport;
}

/**
 * Assemble the chosen plugins and write the index each provider reads.
 *
 * Only the chosen plugins are written, and the destination's `plugins/`
 * directory is replaced, so a build is always a complete description of what
 * the marketplace offers.
 */
export async function buildMarketplace(
  entries: PluginEntry[],
  destination = getMarketplaceDir()
): Promise<BuiltPlugin[]> {
  await fs.rm(path.join(destination, 'plugins'), { recursive: true, force: true });

  const built: BuiltPlugin[] = [];

  for (const entry of entries) {
    const source = getPluginInstallDir(entry.name);
    if (!(await fs.stat(source).catch(() => null))?.isDirectory()) continue;

    const report = await assemblePlugin(
      entry,
      source,
      path.join(destination, 'plugins', entry.name)
    );
    built.push({ entry, report });
  }

  const listed = built.map(({ entry }) => ({
    name: entry.name,
    description: entry.description,
    version: entry.version,
    author: entry.author ? { name: entry.author } : undefined,
    keywords: entry.keywords,
  }));

  // Claude's shape. Grok reads this one too, and is given its own copy so that
  // a Grok-only change to either format does not silently break the other.
  const claudeStyle = {
    name: MARKETPLACE_NAME,
    owner: { name: 'acm' },
    metadata: { description: 'Plugins managed by acm', version: '1.0.0' },
    plugins: listed.map((p) => ({ ...p, source: `./plugins/${p.name}` })),
  };

  // Codex spells the source as an object and keeps the index under `.agents`.
  const codexStyle = {
    name: MARKETPLACE_NAME,
    interface: { displayName: 'acm catalog' },
    plugins: listed.map((p) => ({
      ...p,
      source: { source: 'local', path: `./plugins/${p.name}` },
      policy: { installation: 'AVAILABLE' },
    })),
  };

  await writeJson(path.join(destination, '.claude-plugin', 'marketplace.json'), claudeStyle);
  await writeJson(path.join(destination, '.grok-plugin', 'marketplace.json'), claudeStyle);
  await writeJson(path.join(destination, '.agents', 'plugins', 'marketplace.json'), codexStyle);

  return built;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** The provider CLI, and the arguments that add the marketplace to it. */
const REGISTER: Record<TargetName, { cli: string; args: (dir: string) => string[] } | null> = {
  claude: { cli: 'claude', args: (dir) => ['plugin', 'marketplace', 'add', dir] },
  codex: { cli: 'codex', args: (dir) => ['plugin', 'marketplace', 'add', dir] },
  grok: { cli: 'grok', args: (dir) => ['plugin', 'marketplace', 'add', dir] },
  // Antigravity installs from a path instead; see installCommand below.
  antigravity: null,
};

export interface RegisterResult {
  target: TargetName;
  /** What was run, for the user to repeat or undo. */
  command: string;
  ok: boolean;
  /** Already registered from an earlier run — the desired state, not a failure. */
  alreadyRegistered: boolean;
  output: string;
}

/** Registering twice is how a rebuild looks, and every provider says so differently. */
function meansAlreadyRegistered(output: string): boolean {
  return /already (configured|added|exists|registered)|duplicate marketplace/i.test(output);
}

/**
 * Add the marketplace to a provider.
 *
 * A missing CLI is reported rather than thrown: `acm` is expected to work on a
 * machine where not every provider is installed.
 */
export async function registerMarketplace(
  target: TargetName,
  destination = getMarketplaceDir()
): Promise<RegisterResult | null> {
  const spec = REGISTER[target];
  if (!spec) return null;

  const args = spec.args(destination);
  const command = `${spec.cli} ${args.join(' ')}`;

  try {
    const { stdout, stderr } = await run(spec.cli, args, { timeout: 120_000 });
    return {
      target,
      command,
      ok: true,
      alreadyRegistered: false,
      output: (stdout || stderr).trim(),
    };
  } catch (error: any) {
    const output = (error?.stderr || error?.stdout || error?.message || '').trim();
    const already = meansAlreadyRegistered(output);
    return { target, command, ok: already, alreadyRegistered: already, output };
  }
}

/** How a user installs one plugin, once the marketplace is registered. */
export function installCommand(target: TargetName, name: string, destination: string): string {
  switch (target) {
    case 'claude':
      return `claude plugin install ${name}@${MARKETPLACE_NAME}`;
    case 'codex':
      return `codex plugin add ${name}@${MARKETPLACE_NAME}`;
    case 'grok':
      return `grok plugin install ${path.join(destination, 'plugins', name)} --trust`;
    case 'antigravity':
      return `agy plugin install ${path.join(destination, 'plugins', name)}`;
  }
}
