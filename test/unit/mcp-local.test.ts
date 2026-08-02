import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isLocalRecipe, localRecipe, packageRecipe } from '../../src/mcp-local.js';

const TEST_DIR = path.join(os.tmpdir(), 'acm-mcp-local-test');

describe('Recipes for servers under development', () => {
  before(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('launches a Python project through its console script', async () => {
    const dir = path.join(TEST_DIR, 'py-server');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "py-server"\n\n[project.scripts]\npy-server = "py_server.__main__:main"\n'
    );

    const recipe = await localRecipe(dir);
    assert.strictEqual(recipe.command, 'uv');
    assert.deepStrictEqual(recipe.args, ['run', '--directory', dir, 'py-server']);
  });

  it('falls back to the project name when no console script is declared', async () => {
    const dir = path.join(TEST_DIR, 'py-plain');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "py-plain"\n');

    const recipe = await localRecipe(dir);
    assert.deepStrictEqual(recipe.args, ['run', '--directory', dir, 'py-plain']);
  });

  it('launches a Node project through its bin entry', async () => {
    const dir = path.join(TEST_DIR, 'node-server');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'node-server', bin: { 'node-server': 'dist/cli.js' } })
    );

    const recipe = await localRecipe(dir);
    assert.strictEqual(recipe.command, 'node');
    assert.deepStrictEqual(recipe.args, [path.join(dir, 'dist/cli.js')]);
  });

  it('uses bun when the entry point is TypeScript', async () => {
    // node cannot run a .ts entry point directly.
    const dir = path.join(TEST_DIR, 'bun-server');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'bun-server', main: 'src/index.ts' })
    );

    const recipe = await localRecipe(dir);
    assert.strictEqual(recipe.command, 'bun');
    assert.deepStrictEqual(recipe.args, ['run', path.join(dir, 'src/index.ts')]);
  });

  it('explains itself when the directory is not a recognisable project', async () => {
    const dir = path.join(TEST_DIR, 'mystery');
    await fs.mkdir(dir, { recursive: true });

    await assert.rejects(localRecipe(dir), /No pyproject.toml or package.json/);
    await assert.rejects(localRecipe(path.join(TEST_DIR, 'absent')), /Not a directory/);
  });

  it('builds a published-package recipe', () => {
    const recipe = packageRecipe('@scope/server');
    assert.strictEqual(recipe.command, 'npx');
    assert.deepStrictEqual(recipe.args, ['-y', '@scope/server']);
  });

  it('tells a working copy apart from a published package', () => {
    assert.strictEqual(isLocalRecipe(packageRecipe('@scope/server')), false);
    assert.strictEqual(
      isLocalRecipe({ command: 'uv', args: ['run', '--directory', '/Users/someone/src', 'x'] }),
      true
    );
  });
});
