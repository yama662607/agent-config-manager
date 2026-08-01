import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DIR = path.join(os.tmpdir(), 'acm-config-resolution-test');

/**
 * acm-config resolves paths at call time, so a fresh import per case is not
 * needed; only the environment has to be restored.
 */
const savedEnv = process.env.ACM_CATALOG_DIR;

async function loadModule() {
  // Cache-busting import so config.toml is re-read for each case.
  return import(`../../src/acm-config.js?${Date.now()}${Math.random()}`);
}

describe('Catalog directory resolution', () => {
  beforeEach(() => {
    delete process.env.ACM_CATALOG_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ACM_CATALOG_DIR;
    } else {
      process.env.ACM_CATALOG_DIR = savedEnv;
    }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('defaults to the state directory', async () => {
    const { getCatalogDir, getStateDir, describeCatalogSource } = await loadModule();
    assert.strictEqual(getCatalogDir(), getStateDir());
    assert.strictEqual(describeCatalogSource(), 'default');
  });

  it('honors ACM_CATALOG_DIR', async () => {
    process.env.ACM_CATALOG_DIR = TEST_DIR;
    const { getCatalogDir, describeCatalogSource } = await loadModule();
    assert.strictEqual(getCatalogDir(), path.resolve(TEST_DIR));
    assert.strictEqual(describeCatalogSource(), 'env');
  });

  it('expands ~ in ACM_CATALOG_DIR', async () => {
    process.env.ACM_CATALOG_DIR = '~/some-catalog';
    const { getCatalogDir } = await loadModule();
    assert.strictEqual(getCatalogDir(), path.join(os.homedir(), 'some-catalog'));
  });

  it('keeps the state directory fixed regardless of the catalog location', async () => {
    process.env.ACM_CATALOG_DIR = TEST_DIR;
    const { getStateDir, getConfigPath } = await loadModule();
    assert.strictEqual(getStateDir(), path.join(os.homedir(), '.acm'));
    assert.strictEqual(getConfigPath(), path.join(os.homedir(), '.acm', 'config.toml'));
  });

  it('ignores an empty ACM_CATALOG_DIR', async () => {
    process.env.ACM_CATALOG_DIR = '';
    const { getCatalogDir, getStateDir } = await loadModule();
    assert.strictEqual(getCatalogDir(), getStateDir());
  });
});

describe('Plugin config writes', () => {
  it('preserves keys it does not own', async () => {
    // config.toml is shared: a plugin scan must not drop catalog_dir.
    const configPath = path.join(TEST_DIR, 'config.toml');
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(configPath, 'catalog_dir = "/somewhere/else"\nunrelated = 42\n');

    const TOML = await import('smol-toml');
    const existing = TOML.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const merged = { ...existing, extraPluginPaths: ['/x'], lastScanAt: '2026-08-02T00:00:00Z' };
    fs.writeFileSync(configPath, TOML.stringify(merged as any));

    const after = TOML.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    assert.strictEqual(after.catalog_dir, '/somewhere/else');
    assert.strictEqual(after.unrelated, 42);
    assert.deepStrictEqual(after.extraPluginPaths, ['/x']);
  });
});
