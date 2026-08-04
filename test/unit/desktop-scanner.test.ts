import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { summarizeGitDrift } from '../../src/catalog-drift.js';

const TEST_DIR = path.join(os.tmpdir(), 'acm-desktop-scanner-test');

describe('Catalog drift grouping', () => {
  it('groups changed files by catalog area', () => {
    const areas = summarizeGitDrift([
      { file: 'skills/a/SKILL.md', status: 'M' },
      { file: 'skills/b/SKILL.md', status: '??' },
      { file: 'plugins/c/plugin.json', status: 'M' },
      { file: 'catalog.toml', status: 'M' },
    ]);

    assert.strictEqual(areas.get('skills'), 2);
    assert.strictEqual(areas.get('plugins'), 1);
    assert.strictEqual(areas.get('other files'), 1);
  });
});

describe('Desktop plugin discovery', () => {
  before(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('identifies a plugin by its manifest or its skills', async () => {
    // Discovery cannot rely on a fixed path: applications nest their bundles
    // differently and move them on update. Both shapes must be recognised.
    const { scanDesktopPlugins } = await import('../../src/desktop-scanner.js');
    assert.strictEqual(typeof scanDesktopPlugins, 'function');
  });

  it('finds the plugins bundled on this machine', async () => {
    const { scanDesktopPlugins } = await import('../../src/desktop-scanner.js');
    const found = await scanDesktopPlugins();

    for (const plugin of found) {
      assert.ok(plugin.name, 'every plugin needs a name');
      assert.ok(path.isAbsolute(plugin.sourcePath), 'source paths are absolute');
      assert.ok(Array.isArray(plugin.skills));
    }
  });
});

describe('What the application records about a plugin', () => {
  const ROOT = path.join(os.tmpdir(), 'acm-desktop-record-test');

  before(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  after(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('reads a marketplace plugin from the manifest one level up', async () => {
    // Claude Desktop names these directories after an opaque id, so the outer
    // manifest is the only place the name, marketplace and update time exist.
    const { describeSource } = await import('../../src/desktop-scanner.js');

    const rpm = path.join(ROOT, 'rpm');
    const plugin = path.join(rpm, 'plugin_01KmRfL8EXGF3PeqMRzef1TR');
    await fs.mkdir(plugin, { recursive: true });
    await fs.writeFile(
      path.join(rpm, 'manifest.json'),
      JSON.stringify({
        plugins: [
          {
            id: 'plugin_01KmRfL8EXGF3PeqMRzef1TR',
            name: 'finance',
            updatedAt: '2026-08-04T00:17:31.527092Z',
            marketplaceName: 'knowledge-work-plugins',
          },
        ],
      }),
      'utf8'
    );

    const described = await describeSource(plugin);

    assert.strictEqual(described.marketplace, 'knowledge-work-plugins');
    assert.strictEqual(described.reportedUpdatedAt, '2026-08-04T00:17:31.527092Z');
  });

  it("prefers the plugin's own manifest when it has one", async () => {
    const { describeSource } = await import('../../src/desktop-scanner.js');

    const own = path.join(ROOT, 'own');
    await fs.mkdir(own, { recursive: true });
    await fs.writeFile(
      path.join(own, 'manifest.json'),
      JSON.stringify({ lastUpdated: 1785880870058 }),
      'utf8'
    );

    const described = await describeSource(own);

    assert.strictEqual(described.reportedUpdatedAt, new Date(1785880870058).toISOString());
    assert.strictEqual(described.marketplace, undefined);
  });

  it('reports nothing for a directory the application does not list', async () => {
    const { describeSource } = await import('../../src/desktop-scanner.js');

    const orphan = path.join(ROOT, 'orphan');
    await fs.mkdir(orphan, { recursive: true });

    const described = await describeSource(orphan);

    assert.strictEqual(described.reportedUpdatedAt, undefined);
    assert.strictEqual(described.marketplace, undefined);
  });
});

describe('Search scope', () => {
  it('skips application bundles with no agent content', async () => {
    // Two audio applications alone accounted for 24,000 directories of the
    // old search. The check is one readdir per bundle, before walking.
    const { scanDesktopPlugins } = await import('../../src/desktop-scanner.js');

    const started = Date.now();
    const found = await scanDesktopPlugins();
    const elapsed = Date.now() - started;

    // Generous: the point is that it is seconds, not tens of seconds.
    assert.ok(elapsed < 15_000, `scan took ${elapsed}ms`);
    assert.ok(Array.isArray(found));
  });
});
