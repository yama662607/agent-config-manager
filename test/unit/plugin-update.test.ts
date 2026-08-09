import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A bundled plugin is replaced wholesale when its application updates, so the
 * question `acm doctor` and `acm plugin update` both answer is whether the
 * source still matches what was imported. The comparison is by content digest
 * rather than by timestamp or version, because an application can ship new
 * files without changing either.
 */

const ROOT = path.join(os.tmpdir(), 'acm-plugin-update-test');
const CATALOG = path.join(ROOT, 'catalog');
const SOURCE = path.join(ROOT, 'source');

let previousCatalogDir: string | undefined;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

/** Record the plugin in the catalog with the digest its source has right now. */
async function recordPlugin(): Promise<void> {
  const { digestSkillDir } = await import('../../src/skill-placement.js');
  const digest = await digestSkillDir(SOURCE);

  await write(
    path.join(CATALOG, 'plugins-metadata.toml'),
    [
      'version = "1.0"',
      '',
      '[plugins.bundled-demo]',
      'name = "bundled-demo"',
      `sourcePath = "${SOURCE}"`,
      `sourceDigest = "${digest}"`,
      'sourceApp = "DemoApp"',
      'sourceAppVersion = "1.0.0"',
      'skills = []',
      'agent = "claude"',
      'installedAt = "2026-01-01T00:00:00.000Z"',
      'updatedAt = "2026-01-01T00:00:00.000Z"',
      '',
    ].join('\n')
  );
}

describe('Noticing that a plugin source moved on', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await write(path.join(SOURCE, 'skills', 'demo', 'SKILL.md'), '# demo v1\n');
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = CATALOG;
    await recordPlugin();
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('says nothing while the source still matches', async () => {
    const { pluginSourceDrift } = await import('../../src/catalog-drift.js');

    const drift = await pluginSourceDrift();

    assert.strictEqual(
      drift.find((d) => d.id === 'bundled-demo'),
      undefined
    );
  });

  it('reports a source whose contents changed', async () => {
    const { pluginSourceDrift } = await import('../../src/catalog-drift.js');

    // Same file count, same version — only the contents differ.
    await write(path.join(SOURCE, 'skills', 'demo', 'SKILL.md'), '# demo v2\n');

    const drift = await pluginSourceDrift();
    const mine = drift.find((d) => d.id === 'bundled-demo');

    assert.ok(mine, 'a changed source should be reported');
    assert.match(mine.detail, /changed/);
  });

  it('says nothing about a source that is not on this machine', async () => {
    // Once a catalog is shared between machines, this is the normal state for
    // every application the second machine does not have. Reporting it as drift
    // would mean a permanent, unactionable entry that never clears, and a
    // report people stop reading. It belongs under portability instead.
    const { pluginSourceDrift } = await import('../../src/catalog-drift.js');

    await fs.rm(SOURCE, { recursive: true, force: true });

    const drift = await pluginSourceDrift();
    assert.strictEqual(
      drift.find((d) => d.id === 'bundled-demo'),
      undefined
    );
  });

  it('reports that source under portability, naming the application', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');

    await fs.rm(SOURCE, { recursive: true, force: true });

    const references = await machineReferences(CATALOG);
    const mine = references.find((r) => r.id === 'bundled-demo');

    assert.ok(mine, 'an absent plugin source should be reported');
    assert.strictEqual(mine.kind, 'plugin source');
    assert.strictEqual(mine.present, false);
    assert.strictEqual(mine.variable, 'DemoApp');
  });
});

describe('Storing where a plugin came from', () => {
  it('records a path under the home directory as ~-relative', async () => {
    // The catalog is shared between machines. The same location spelled
    // with one user name here and another there is one place described twice,
    // and every import would rewrite what the other machine had just committed.
    const { toPortablePath, fromPortablePath } = await import('../../src/acm-config.js');

    const inside = path.join(os.homedir(), 'Library', 'Application Support', 'Demo');
    assert.strictEqual(toPortablePath(inside), '~/Library/Application Support/Demo');
    assert.strictEqual(fromPortablePath(toPortablePath(inside)), inside);
  });

  it('leaves a path outside the home directory alone', async () => {
    // An application bundle is a fact about the machine, not about the user.
    const { toPortablePath } = await import('../../src/acm-config.js');

    assert.strictEqual(toPortablePath('/Applications/Warp.app'), '/Applications/Warp.app');
  });

  it('still resolves the absolute paths written before this change', async () => {
    const { fromPortablePath } = await import('../../src/acm-config.js');

    assert.strictEqual(fromPortablePath('/Applications/Warp.app'), '/Applications/Warp.app');
  });
});
