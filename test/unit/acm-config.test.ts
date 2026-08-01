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
const savedHome = process.env.HOME;
const FAKE_HOME = path.join(TEST_DIR, 'home');

async function loadModule() {
  // Cache-busting import so config.toml is re-read for each case.
  return import(`../../src/acm-config.js?${Date.now()}${Math.random()}`);
}

describe('Catalog directory resolution', () => {
  beforeEach(() => {
    delete process.env.ACM_CATALOG_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Isolate from the developer's own ~/.acm/config.toml.
    fs.mkdirSync(FAKE_HOME, { recursive: true });
    process.env.HOME = FAKE_HOME;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ACM_CATALOG_DIR;
    } else {
      process.env.ACM_CATALOG_DIR = savedEnv;
    }
    if (savedHome !== undefined) process.env.HOME = savedHome;
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
    assert.strictEqual(getCatalogDir(), path.join(FAKE_HOME, 'some-catalog'));
  });

  it('keeps the state directory fixed regardless of the catalog location', async () => {
    process.env.ACM_CATALOG_DIR = TEST_DIR;
    const { getStateDir, getConfigPath } = await loadModule();
    assert.strictEqual(getStateDir(), path.join(FAKE_HOME, '.acm'));
    assert.strictEqual(getConfigPath(), path.join(FAKE_HOME, '.acm', 'config.toml'));
  });

  it('reads catalog_dir from config.toml', async () => {
    const stateDir = path.join(FAKE_HOME, '.acm');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'config.toml'), `catalog_dir = "${TEST_DIR}"\n`);

    const { getCatalogDir, describeCatalogSource } = await loadModule();
    assert.strictEqual(getCatalogDir(), path.resolve(TEST_DIR));
    assert.strictEqual(describeCatalogSource(), 'config');
  });

  it('lets ACM_CATALOG_DIR win over config.toml', async () => {
    const stateDir = path.join(FAKE_HOME, '.acm');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'config.toml'), 'catalog_dir = "/from/config"\n');
    process.env.ACM_CATALOG_DIR = '/from/env';

    const { getCatalogDir, describeCatalogSource } = await loadModule();
    assert.strictEqual(getCatalogDir(), '/from/env');
    assert.strictEqual(describeCatalogSource(), 'env');
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

describe('Default targets', () => {
  const FAKE = path.join(TEST_DIR, 'home2');

  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(FAKE, '.acm'), { recursive: true });
    process.env.HOME = FAKE;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns null when unset, so the built-in default applies', async () => {
    fs.writeFileSync(path.join(FAKE, '.acm', 'config.toml'), 'catalog_dir = "/x"\n');
    const { getDefaultTargets } = await loadModule();
    assert.strictEqual(getDefaultTargets(), null);
  });

  it('reads default_targets from config.toml', async () => {
    fs.writeFileSync(
      path.join(FAKE, '.acm', 'config.toml'),
      'default_targets = ["claude", "grok"]\n'
    );
    const { getDefaultTargets } = await loadModule();
    assert.deepStrictEqual(getDefaultTargets(), ['claude', 'grok']);
  });

  it('ignores an empty list', async () => {
    fs.writeFileSync(path.join(FAKE, '.acm', 'config.toml'), 'default_targets = []\n');
    const { getDefaultTargets } = await loadModule();
    assert.strictEqual(getDefaultTargets(), null);
  });
});
