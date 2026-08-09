import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A catalog is meant to be carried — cloned onto a second machine, or restored
 * after a rebuild. Most of it travels. What does not is a skill symlinked into
 * a development repository, or an MCP recipe naming a binary, a checkout or a
 * vault by absolute path. Those are deliberate, so they are listed rather than
 * objected to; the useful fact is which of them exist here.
 */

const ROOT = path.join(os.tmpdir(), 'acm-portability-test');
const CATALOG = path.join(ROOT, 'catalog');
const ELSEWHERE = path.join(ROOT, 'dev-repo');

let previousCatalogDir: string | undefined;

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function writeCatalog(mcps: string[] = []): Promise<void> {
  await write(
    path.join(CATALOG, 'catalog.toml'),
    ['version = "1.0"', '', ...mcps, ''].join('\n')
  );
}

function mcpEntry(id: string, body: string[]): string[] {
  return [
    `[mcps.${id}]`,
    `id = "${id}"`,
    `displayName = "${id}"`,
    `description = "x"`,
    `addedAt = "2026-08-02T00:00:00.000Z"`,
    `[mcps.${id}.recipe]`,
    ...body,
    '',
  ];
}

describe('What the catalog expects to find on this machine', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(CATALOG, 'skills'), { recursive: true });
    previousCatalogDir = process.env.ACM_CATALOG_DIR;
    process.env.ACM_CATALOG_DIR = CATALOG;
  });

  afterEach(async () => {
    if (previousCatalogDir === undefined) delete process.env.ACM_CATALOG_DIR;
    else process.env.ACM_CATALOG_DIR = previousCatalogDir;
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('says nothing about a catalog that carries only its own files', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');
    await writeCatalog(mcpEntry('portable', ['command = "npx"', 'args = ["-y", "@demo/server"]']));
    await write(path.join(CATALOG, 'skills', 'plain', 'SKILL.md'), '# plain\n');

    assert.deepStrictEqual(await machineReferences(CATALOG), []);
  });

  it('reports a skill linked outside the catalog, and whether it is there', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');
    await writeCatalog();
    await write(path.join(ELSEWHERE, 'SKILL.md'), '# from a dev repo\n');
    await fs.symlink(ELSEWHERE, path.join(CATALOG, 'skills', 'linked'));

    const present = await machineReferences(CATALOG);
    assert.deepStrictEqual(present, [
      { kind: 'skill link', id: 'linked', target: ELSEWHERE, present: true },
    ]);

    // The same catalog on a machine without that repository.
    await fs.rm(ELSEWHERE, { recursive: true, force: true });
    const missing = await machineReferences(CATALOG);
    assert.strictEqual(missing[0].present, false);
  });

  it('ignores a link that stays inside the catalog, since it travels with it', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');
    await writeCatalog();
    await write(path.join(CATALOG, 'skills', 'real', 'SKILL.md'), '# real\n');
    await fs.symlink(
      path.join(CATALOG, 'skills', 'real'),
      path.join(CATALOG, 'skills', 'alias')
    );

    assert.deepStrictEqual(await machineReferences(CATALOG), []);
  });

  it('reports absolute paths in a recipe, naming the environment variable', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');
    const binary = path.join(ROOT, 'bin', 'thing');
    const vault = path.join(ROOT, 'vault');

    await writeCatalog(
      mcpEntry('local-tool', [
        `command = "${binary}"`,
        `args = ["${vault}", "--flag"]`,
        '[mcps.local-tool.recipe.env]',
        `VAULT_PATH = "${vault}"`,
        'PLAIN = "not-a-path"',
      ])
    );

    const references = await machineReferences(CATALOG);

    assert.deepStrictEqual(
      references.map((r) => [r.kind, r.target, r.variable ?? null]),
      [
        ['command', binary, null],
        ['argument', vault, null],
        ['environment', vault, 'VAULT_PATH'],
      ]
    );
    assert.ok(references.every((r) => !r.present));
  });

  it('puts what is missing first, so the list reads as the work to do', async () => {
    const { machineReferences } = await import('../../src/catalog-portability.js');
    const here = path.join(ROOT, 'here');
    const gone = path.join(ROOT, 'gone');
    await fs.mkdir(here, { recursive: true });

    await writeCatalog([
      ...mcpEntry('a-present', [`command = "${here}"`]),
      ...mcpEntry('z-missing', [`command = "${gone}"`]),
    ]);

    const references = await machineReferences(CATALOG);

    assert.deepStrictEqual(
      references.map((r) => [r.id, r.present]),
      [
        ['z-missing', false],
        ['a-present', true],
      ]
    );
  });
});
