import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';

import {
  getDisabledSkills,
  getRegisteredSkillPaths,
  isSkillPathRegistered,
  registerSkillPath,
  setSkillDisabled,
  unregisterSkillPath,
} from '../../src/grok-skills.js';
import { getSkills } from '../../src/skill-adapters.js';

const TEST_DIR = path.join(os.tmpdir(), 'acm-grok-skills-test');
const PROJECT_DIR = path.join(TEST_DIR, 'project');
const CONFIG_PATH = path.join(PROJECT_DIR, '.grok', 'config.toml');
const CATALOG_SKILLS = path.join(TEST_DIR, 'catalog', 'skills');

async function writeCatalogSkill(name: string): Promise<void> {
  const dir = path.join(CATALOG_SKILLS, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
}

describe('Grok skill registration', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('registers a skills directory once and reports it', async () => {
    assert.strictEqual(await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS), true);
    assert.strictEqual(await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS), false);

    assert.strictEqual(await isSkillPathRegistered(CONFIG_PATH, CATALOG_SKILLS), true);
    assert.deepStrictEqual(await getRegisteredSkillPaths(CONFIG_PATH), [CATALOG_SKILLS]);
  });

  it('creates the config file when it does not exist yet', async () => {
    await fs.rm(CONFIG_PATH, { force: true });

    await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS);

    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    assert.match(raw, /\[skills\]/);
  });

  it('preserves unrelated config sections', async () => {
    await fs.writeFile(
      CONFIG_PATH,
      ['[cli]', 'installer = "internal"', '', '[ui]', 'yolo = false', ''].join('\n')
    );

    await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS);
    await setSkillDisabled(CONFIG_PATH, 'noisy-skill', true);

    const config = TOML.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as any;
    assert.strictEqual(config.cli.installer, 'internal');
    assert.strictEqual(config.ui.yolo, false);
    assert.deepStrictEqual(config.skills.paths, [CATALOG_SKILLS]);
    assert.deepStrictEqual(config.skills.disabled, ['noisy-skill']);
  });

  it('keeps other registered paths when unregistering one', async () => {
    const other = path.join(TEST_DIR, 'other-skills');
    await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS);
    await registerSkillPath(CONFIG_PATH, other);

    assert.strictEqual(await unregisterSkillPath(CONFIG_PATH, CATALOG_SKILLS), true);
    assert.deepStrictEqual(await getRegisteredSkillPaths(CONFIG_PATH), [other]);

    // Removing something that is not registered is a no-op.
    assert.strictEqual(await unregisterSkillPath(CONFIG_PATH, CATALOG_SKILLS), false);
  });

  it('matches registered paths written with a ~ prefix', async () => {
    const homeRelative = '~/.acm/skills';
    await fs.writeFile(CONFIG_PATH, `[skills]\npaths = ["${homeRelative}"]\n`);

    const expanded = path.join(os.homedir(), '.acm', 'skills');
    assert.strictEqual(await isSkillPathRegistered(CONFIG_PATH, expanded), true);
    assert.deepStrictEqual(await getRegisteredSkillPaths(CONFIG_PATH), [expanded]);
  });

  it('toggles a single skill through [skills] disabled', async () => {
    assert.strictEqual(await setSkillDisabled(CONFIG_PATH, 'demo', true), true);
    assert.deepStrictEqual(await getDisabledSkills(CONFIG_PATH), ['demo']);

    // Idempotent in both directions.
    assert.strictEqual(await setSkillDisabled(CONFIG_PATH, 'demo', true), false);
    assert.strictEqual(await setSkillDisabled(CONFIG_PATH, 'demo', false), true);
    assert.deepStrictEqual(await getDisabledSkills(CONFIG_PATH), []);
  });

  it('lists registered catalog skills as Grok skills, honoring disabled', async () => {
    await writeCatalogSkill('alpha');
    await writeCatalogSkill('beta');
    await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS);
    await setSkillDisabled(CONFIG_PATH, 'beta', true);

    const skills = await getSkills(PROJECT_DIR, 'grok');

    assert.deepStrictEqual(skills, {
      alpha: { enabled: true },
      beta: { enabled: false },
    });
  });

  it('ignores registered paths that no longer exist', async () => {
    await registerSkillPath(CONFIG_PATH, path.join(TEST_DIR, 'gone'));

    assert.deepStrictEqual(await getSkills(PROJECT_DIR, 'grok'), {});
  });

  it('still lists skills placed directly in .grok/skills', async () => {
    const local = path.join(PROJECT_DIR, '.grok', 'skills', 'local-skill');
    await fs.mkdir(local, { recursive: true });
    await fs.writeFile(path.join(local, 'SKILL.md'), '---\nname: local-skill\n---\n\nbody\n');

    const skills = await getSkills(PROJECT_DIR, 'grok');
    assert.deepStrictEqual(skills, { 'local-skill': { enabled: true } });
  });

  it('does not touch other targets', async () => {
    await writeCatalogSkill('alpha');
    await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS);

    assert.deepStrictEqual(await getSkills(PROJECT_DIR, 'claude'), {});
  });
});

/**
 * `~/.acm/skills` is a symlink to the catalog, so the state directory's
 * entrance and the catalog's own path name one directory in two ways. Comparing
 * the written strings let both be registered, and Grok scanned every catalog
 * skill twice.
 */
describe('Registering the same directory by two names', () => {
  const ENTRANCE = path.join(TEST_DIR, 'state', 'skills');

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.mkdir(CATALOG_SKILLS, { recursive: true });
    await fs.mkdir(path.dirname(ENTRANCE), { recursive: true });
    await fs.symlink(CATALOG_SKILLS, ENTRANCE);
  });

  it('registers a directory reached through a symlink only once', async () => {
    assert.strictEqual(await registerSkillPath(CONFIG_PATH, CATALOG_SKILLS), true);
    assert.strictEqual(await registerSkillPath(CONFIG_PATH, ENTRANCE), false);

    assert.deepStrictEqual(await getRegisteredSkillPaths(CONFIG_PATH), [CATALOG_SKILLS]);
  });

  it('reports the catalog as registered when the entrance was registered', async () => {
    await registerSkillPath(CONFIG_PATH, ENTRANCE);

    assert.strictEqual(await isSkillPathRegistered(CONFIG_PATH, CATALOG_SKILLS), true);
  });

  it('unregisters through either name', async () => {
    await registerSkillPath(CONFIG_PATH, ENTRANCE);

    assert.strictEqual(await unregisterSkillPath(CONFIG_PATH, CATALOG_SKILLS), true);
    assert.deepStrictEqual(await getRegisteredSkillPaths(CONFIG_PATH), []);
  });

  it('still compares a path that does not exist yet', async () => {
    // A machine can be configured before its catalog is cloned.
    const absent = path.join(TEST_DIR, 'not-cloned', 'skills');

    assert.strictEqual(await registerSkillPath(CONFIG_PATH, absent), true);
    assert.strictEqual(await registerSkillPath(CONFIG_PATH, absent), false);
  });
});
