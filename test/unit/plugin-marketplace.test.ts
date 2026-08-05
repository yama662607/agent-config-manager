import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { PluginEntry } from '../../src/types.js';

/**
 * The four providers differ only in where they look for a manifest, so an
 * assembled plugin carries all four locations rather than being converted per
 * provider. Verified against the real CLIs — `claude plugin validate`,
 * `grok plugin validate` and `agy plugin validate` all accept one such
 * directory — and pinned here so the shape does not drift.
 */

const ROOT = path.join(os.tmpdir(), 'acm-plugin-marketplace-test');
const CATALOG = path.join(ROOT, 'catalog');
const OUT = path.join(ROOT, 'marketplace');

let previousCatalogDir: string | undefined;

const ENTRY: PluginEntry = {
  name: 'demo',
  version: '2.0.0',
  description: 'A demo plugin',
  author: 'Someone',
  agent: 'codex',
  sourcePath: '/nowhere',
  skills: ['alpha', 'beta'],
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as PluginEntry;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function buildCatalog(): Promise<void> {
  // A plugin as the catalog stores it: manifest and commands, but no skills —
  // those live alongside every other skill in the catalog.
  await write(
    path.join(CATALOG, 'plugins', 'demo', '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '2.0.0',
      apps: { demo: { id: 'asdk_1' } },
      interface: { displayName: 'Demo' },
      sourceAgent: 'codex',
      installedFor: ['claude'],
      installedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await write(path.join(CATALOG, 'plugins', 'demo', 'commands', 'go.md'), '# go\n');

  await write(path.join(CATALOG, 'skills', 'alpha', 'SKILL.md'), '# alpha\n');
  await write(path.join(CATALOG, 'skills', 'alpha', 'scripts', 'run.sh'), 'echo\n');
  // `beta` is declared but absent, so the report has something to say.
}

describe('Assembling a plugin every provider can read', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await buildCatalog();
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = CATALOG;
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('writes the manifest to every location a provider looks in', async () => {
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');
    const destination = path.join(OUT, 'demo');

    await assemblePlugin(ENTRY, path.join(CATALOG, 'plugins', 'demo'), destination);

    for (const location of [
      path.join('.claude-plugin', 'plugin.json'),
      path.join('.codex-plugin', 'plugin.json'),
      path.join('.grok-plugin', 'plugin.json'),
      'plugin.json',
    ]) {
      const manifest = JSON.parse(await fs.readFile(path.join(destination, location), 'utf8'));
      assert.strictEqual(manifest.name, 'demo', `${location} should carry the manifest`);
    }
  });

  it("pulls the plugin's skills back out of the catalog", async () => {
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');
    const destination = path.join(OUT, 'demo');

    const report = await assemblePlugin(ENTRY, path.join(CATALOG, 'plugins', 'demo'), destination);

    assert.deepStrictEqual(report.skillsRestored, ['alpha']);
    // The whole directory, not just SKILL.md.
    const script = await fs.readFile(
      path.join(destination, 'skills', 'alpha', 'scripts', 'run.sh'),
      'utf8'
    );
    assert.strictEqual(script, 'echo\n');
  });

  it('names skills the catalog no longer holds instead of dropping them', async () => {
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');

    const report = await assemblePlugin(
      ENTRY,
      path.join(CATALOG, 'plugins', 'demo'),
      path.join(OUT, 'demo')
    );

    assert.deepStrictEqual(report.skillsMissing, ['beta']);
  });

  it('reports fields only some providers read, and keeps them', async () => {
    // Stripping would lose them on the way back, so they are carried and named.
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');
    const destination = path.join(OUT, 'demo');

    const report = await assemblePlugin(ENTRY, path.join(CATALOG, 'plugins', 'demo'), destination);

    const fields = report.providerSpecific.map((f) => f.field).sort();
    assert.deepStrictEqual(fields, ['apps', 'interface']);

    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'plugin.json'), 'utf8'));
    assert.deepStrictEqual(manifest.apps, { demo: { id: 'asdk_1' } });
  });

  it("leaves acm's own bookkeeping out of what a provider loads", async () => {
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');
    const destination = path.join(OUT, 'demo');

    await assemblePlugin(ENTRY, path.join(CATALOG, 'plugins', 'demo'), destination);

    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.installedFor, undefined);
    assert.strictEqual(manifest.installedAt, undefined);
    assert.strictEqual(manifest.sourceAgent, undefined);
  });

  it('carries the rest of the plugin across', async () => {
    const { assemblePlugin } = await import('../../src/plugin-assemble.js');
    const destination = path.join(OUT, 'demo');

    await assemblePlugin(ENTRY, path.join(CATALOG, 'plugins', 'demo'), destination);

    assert.strictEqual(await fs.readFile(path.join(destination, 'commands', 'go.md'), 'utf8'), '# go\n');
  });
});

describe('The marketplace index', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await buildCatalog();
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = CATALOG;
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('spells a plugin source the way each provider expects', async () => {
    // Claude and Grok take a path string; Codex takes an object and keeps its
    // index under `.agents`.
    const { buildMarketplace } = await import('../../src/plugin-marketplace.js');

    await buildMarketplace([ENTRY], OUT);

    const claude = JSON.parse(
      await fs.readFile(path.join(OUT, '.claude-plugin', 'marketplace.json'), 'utf8')
    );
    assert.strictEqual(claude.plugins[0].source, './plugins/demo');

    const grok = JSON.parse(
      await fs.readFile(path.join(OUT, '.grok-plugin', 'marketplace.json'), 'utf8')
    );
    assert.strictEqual(grok.plugins[0].source, './plugins/demo');

    const codex = JSON.parse(
      await fs.readFile(path.join(OUT, '.agents', 'plugins', 'marketplace.json'), 'utf8')
    );
    assert.deepStrictEqual(codex.plugins[0].source, { source: 'local', path: './plugins/demo' });
  });

  it('describes only what it built', async () => {
    // A rebuild replaces the plugin directories, so the index must never list a
    // plugin that is no longer there.
    const { buildMarketplace } = await import('../../src/plugin-marketplace.js');

    await buildMarketplace([ENTRY], OUT);
    await buildMarketplace([], OUT);

    const claude = JSON.parse(
      await fs.readFile(path.join(OUT, '.claude-plugin', 'marketplace.json'), 'utf8')
    );
    assert.deepStrictEqual(claude.plugins, []);
    assert.strictEqual(
      await fs.stat(path.join(OUT, 'plugins', 'demo')).catch(() => null),
      null
    );
  });

  it('gives each provider its own install command', async () => {
    const { installCommand, MARKETPLACE_NAME } = await import('../../src/plugin-marketplace.js');

    assert.strictEqual(
      installCommand('claude', 'demo', OUT),
      `claude plugin install demo@${MARKETPLACE_NAME}`
    );
    assert.strictEqual(
      installCommand('codex', 'demo', OUT),
      `codex plugin add demo@${MARKETPLACE_NAME}`
    );
    // Grok and Antigravity install from the path, not from the index.
    assert.ok(installCommand('grok', 'demo', OUT).includes(path.join(OUT, 'plugins', 'demo')));
    assert.ok(installCommand('antigravity', 'demo', OUT).startsWith('agy plugin install '));
  });
});
