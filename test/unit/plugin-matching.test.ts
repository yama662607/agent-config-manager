import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { matchDiscovered } from '../../src/catalog-drift.js';

/**
 * A catalog name is not always the plugin's own. Two applications both ship a
 * plugin called `prompts`, so the second was imported as
 * `visual-studio-code-prompts`, and `acm plugin import --as` can rename
 * anything. Matching a catalog entry to what is on disk by name alone reported
 * those as having no source at all, and `acm plugin update` refused to touch
 * them — they could never be updated.
 */

describe('Pairing a catalog plugin with the copy on this machine', () => {
  const discovered = [
    { name: 'prompts', sourcePath: '/Applications/Editor.app/Contents/prompts' },
    { name: 'bundled', sourcePath: '/Applications/Other.app/Contents/bundled' },
  ];

  it('matches on name when the names agree', () => {
    const found = matchDiscovered({ name: 'bundled', sourcePath: '/gone' }, discovered);
    assert.strictEqual(found?.sourcePath, '/Applications/Other.app/Contents/bundled');
  });

  it('falls back to the recorded source path when the name was qualified', () => {
    const found = matchDiscovered(
      { name: 'editor-prompts', sourcePath: '/Applications/Editor.app/Contents/prompts' },
      discovered
    );
    assert.strictEqual(found?.name, 'prompts');
  });

  it('resolves a stored ~-relative path before comparing', () => {
    const inside = path.join(os.homedir(), 'Library', 'Demo');
    const found = matchDiscovered({ name: 'renamed', sourcePath: '~/Library/Demo' }, [
      { name: 'demo', sourcePath: inside },
    ]);
    assert.strictEqual(found?.name, 'demo');
  });

  it('returns nothing when neither name nor path matches', () => {
    const found = matchDiscovered({ name: 'absent', sourcePath: '/nowhere' }, discovered);
    assert.strictEqual(found, undefined);
  });

  it('prefers the name match over a path match', () => {
    // Two entries could point at one path after a rename; the name is the
    // stronger signal when it is available.
    const found = matchDiscovered({ name: 'bundled', sourcePath: '/Applications/Editor.app/Contents/prompts' }, discovered);
    assert.strictEqual(found?.name, 'bundled');
  });
});

describe('Refusing to take an older copy', () => {
  /**
   * Two machines sharing a catalog can be on different versions of the same
   * application, and whichever imports last wins. Observed: a second Mac on
   * Claude 1.25927.0 would have overwritten what 1.26832.0 contributed.
   */
  it('sees a lower version as older, segment by segment', async () => {
    const { isOlder } = await import('../../src/cli-plugin.js');

    assert.strictEqual(isOlder('1.25927.0', '1.26832.0'), true);
    assert.strictEqual(isOlder('1.9.0', '1.10.0'), true, 'compares numbers, not text');
    assert.strictEqual(isOlder('1.2', '1.2.1'), true, 'a missing segment counts as zero');
  });

  it('does not block an equal or newer version', async () => {
    const { isOlder } = await import('../../src/cli-plugin.js');

    assert.strictEqual(isOlder('1.26832.0', '1.25927.0'), false);
    assert.strictEqual(isOlder('1.2.3', '1.2.3'), false);
    assert.strictEqual(isOlder('1.2.3', '1.2'), false);
  });

  it('lets an update through when it cannot tell', async () => {
    // An unknown or unparseable version must not become a wall: the guard is
    // there to catch a known regression, not to gate every update.
    const { isOlder } = await import('../../src/cli-plugin.js');

    assert.strictEqual(isOlder(undefined, '1.0.0'), false);
    assert.strictEqual(isOlder('1.0.0', undefined), false);
    assert.strictEqual(isOlder('2026.07-beta', '2026.08'), false);
  });
});

const ROOT = path.join(os.tmpdir(), 'acm-ignored-apps-test');

describe('Leaving an application alone', () => {
  let previousCatalogDir: string | undefined;

  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(ROOT, { recursive: true });
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = ROOT;
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('drops plugins from an application named in IGNORED-APPS.txt', async () => {
    // An application installed but not used still ships plugins, and importing
    // them puts skills in front of every agent on every provider.
    const { scanDesktopPlugins } = await import('../../src/desktop-scanner.js');

    const before = await scanDesktopPlugins();
    const apps = [...new Set(before.map((p) => p.app).filter(Boolean))] as string[];
    if (apps.length === 0) return; // Nothing bundled on this machine to test with.

    const victim = apps[0];
    await fs.writeFile(
      path.join(ROOT, 'IGNORED-APPS.txt'),
      `# a comment\n\n${victim}\n`,
      'utf8'
    );

    const after = await scanDesktopPlugins();

    assert.ok(before.some((p) => p.app === victim), 'the fixture should have had one');
    assert.ok(!after.some((p) => p.app === victim), `${victim} should have been dropped`);
    assert.strictEqual(
      after.length,
      before.filter((p) => p.app !== victim).length,
      'nothing else should have been dropped'
    );
  });
});
