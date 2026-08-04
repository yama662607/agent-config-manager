import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A skill is a directory. An earlier import registered plugin skills by reading
 * SKILL.md alone, so 3,533 reference, script and asset files were dropped from
 * 522 skills across the catalog — the instructions survived but everything they
 * pointed at did not. These tests pin down the recovery.
 */

const ROOT = path.join(os.tmpdir(), 'acm-plugin-payload-test');
const CATALOG = path.join(ROOT, 'catalog');
const SOURCE = path.join(ROOT, 'source');

let previousCatalogDir: string | undefined;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

/** A plugin holding one skill that carries files beside SKILL.md. */
async function buildFixture(): Promise<void> {
  await write(path.join(SOURCE, 'skills', 'demo', 'SKILL.md'), '# demo\n');
  await write(path.join(SOURCE, 'skills', 'demo', 'references', 'api.md'), 'reference\n');
  await write(path.join(SOURCE, 'skills', 'demo', 'scripts', 'run.sh'), 'echo hi\n');

  // The catalog holds only the entry point — the state the old import left.
  await write(path.join(CATALOG, 'skills', 'demo', 'SKILL.md'), '# demo\n');

  await write(
    path.join(CATALOG, 'plugins-metadata.toml'),
    [
      'version = "1.0"',
      '',
      '[plugins.demo-plugin]',
      'name = "demo-plugin"',
      `sourcePath = "${SOURCE}"`,
      'skills = ["demo"]',
      'installedAt = "2026-01-01T00:00:00.000Z"',
      'updatedAt = "2026-01-01T00:00:00.000Z"',
      'agent = "claude"',
      '',
    ].join('\n')
  );
}

describe('Plugin payload recovery', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await buildFixture();
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = CATALOG;
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('names the files a truncated skill is missing', async () => {
    const { findTruncatedSkills } = await import('../../src/plugin-payload.js');

    const truncated = await findTruncatedSkills();

    assert.strictEqual(truncated.length, 1);
    assert.strictEqual(truncated[0].plugin, 'demo-plugin');
    assert.strictEqual(truncated[0].skill, 'demo');
    assert.deepStrictEqual(truncated[0].missing, [
      path.join('references', 'api.md'),
      path.join('scripts', 'run.sh'),
    ]);
  });

  it('restores the missing files and then reports nothing', async () => {
    const { findTruncatedSkills, restoreSkill } = await import('../../src/plugin-payload.js');

    const [entry] = await findTruncatedSkills();
    assert.strictEqual(await restoreSkill(entry), 2);

    const restored = await fs.readFile(
      path.join(CATALOG, 'skills', 'demo', 'references', 'api.md'),
      'utf8'
    );
    assert.strictEqual(restored, 'reference\n');

    assert.deepStrictEqual(await findTruncatedSkills(), []);
  });

  it('keeps the catalog version of a file that exists in both places', async () => {
    // The catalog copy may carry the user's own edits, so recovery only adds.
    const { findTruncatedSkills, restoreSkill } = await import('../../src/plugin-payload.js');

    await write(path.join(CATALOG, 'skills', 'demo', 'SKILL.md'), '# edited by hand\n');

    const [entry] = await findTruncatedSkills();
    await restoreSkill(entry);

    const skill = await fs.readFile(path.join(CATALOG, 'skills', 'demo', 'SKILL.md'), 'utf8');
    assert.strictEqual(skill, '# edited by hand\n');
  });

  it('leaves a skill that is linked to a working copy alone', async () => {
    // A linked skill points at a directory the user maintains. Overwriting it
    // would replace their work with a bundled copy.
    const { findTruncatedSkills } = await import('../../src/plugin-payload.js');

    const working = path.join(ROOT, 'working', 'demo');
    await write(path.join(working, 'SKILL.md'), '# working copy\n');

    const catalogSkill = path.join(CATALOG, 'skills', 'demo');
    await fs.rm(catalogSkill, { recursive: true, force: true });
    await fs.symlink(working, catalogSkill);

    assert.deepStrictEqual(await findTruncatedSkills(), []);
  });

  it('reports nothing when the source is no longer on the machine', async () => {
    const { findTruncatedSkills } = await import('../../src/plugin-payload.js');

    await fs.rm(SOURCE, { recursive: true, force: true });

    assert.deepStrictEqual(await findTruncatedSkills(), []);
  });
});

describe('Locating a plugin skill source', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await buildFixture();
  });

  afterEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('prefers the path recorded at import', async () => {
    const { findSkillSource } = await import('../../src/plugin-payload.js');

    assert.strictEqual(
      await findSkillSource('demo-plugin', 'demo', SOURCE),
      path.join(SOURCE, 'skills', 'demo')
    );
  });

  it('returns null when no provider still holds the skill', async () => {
    const { findSkillSource } = await import('../../src/plugin-payload.js');

    assert.strictEqual(
      await findSkillSource('a-plugin-no-one-has', 'a-skill-no-one-has', undefined),
      null
    );
  });
});
