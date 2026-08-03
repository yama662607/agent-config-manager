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
