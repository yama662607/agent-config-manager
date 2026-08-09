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

  it('reports a changed source, and a source that is gone', async () => {
    const { pluginSourceDrift } = await import('../../src/catalog-drift.js');

    // Same file count, same version — only the contents differ.
    await write(path.join(SOURCE, 'skills', 'demo', 'SKILL.md'), '# demo v2\n');
    let drift = await pluginSourceDrift();
    let mine = drift.find((d) => d.id === 'bundled-demo');
    assert.ok(mine, 'a changed source should be reported');
    assert.match(mine.detail, /changed/);

    await fs.rm(SOURCE, { recursive: true, force: true });
    drift = await pluginSourceDrift();
    mine = drift.find((d) => d.id === 'bundled-demo');
    assert.ok(mine, 'a missing source should be reported');
    assert.match(mine.detail, /gone/);
  });
});
