// Unit tests for project discovery (#4: -H/--home should target the home
// directory regardless of cwd)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverProject } from '../../src/project-discovery.js';

const TEST_HOME_DIR = path.join(os.tmpdir(), 'acm-test-home-discovery');
const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'acm-test-project-discovery');

describe('Project Discovery Module', () => {
  let originalHome: string | undefined;

  before(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = TEST_HOME_DIR;

    await fs.rm(TEST_HOME_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_HOME_DIR, { recursive: true });

    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });
  });

  after(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await fs.rm(TEST_HOME_DIR, { recursive: true, force: true });
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
  });

  it('uses cwd as root when --home is not passed', async () => {
    const discovery = await discoverProject(TEST_PROJECT_DIR);
    assert.strictEqual(discovery.root, TEST_PROJECT_DIR);
  });

  it('targets the home directory when --home is passed, even from a project cwd', async () => {
    const discovery = await discoverProject(TEST_PROJECT_DIR, { allowHome: true });
    assert.strictEqual(discovery.root, os.homedir());
  });

  it('still targets the home directory when cwd already is the home directory', async () => {
    const discovery = await discoverProject(os.homedir(), { allowHome: true });
    assert.strictEqual(discovery.root, os.homedir());
  });

  it('throws when cwd is the home directory and --home is not passed', async () => {
    await assert.rejects(() => discoverProject(os.homedir()));
  });
});
