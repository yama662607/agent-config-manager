import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  copySkillDirToConfig,
  defaultPlacementMode,
  getSkillDir,
  removeSkillFromConfig,
} from '../../src/skill-adapters.js';
import { digestSkillDir, inspectSkillPlacement } from '../../src/skill-placement.js';

const TEST_DIR = path.join(os.tmpdir(), 'acm-skill-placement-test');
const CATALOG_DIR = path.join(TEST_DIR, 'catalog', 'skills');
const PROJECT_DIR = path.join(TEST_DIR, 'project');
const SKILL_ID = 'demo-skill';

async function writeCatalogSkill(): Promise<string> {
  const dir = path.join(CATALOG_DIR, SKILL_ID);
  await fs.mkdir(path.join(dir, 'references'), { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: demo-skill\n---\n\nbody\n');
  await fs.writeFile(path.join(dir, 'references', 'notes.md'), 'notes\n');
  return dir;
}

describe('Skill placement', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(PROJECT_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('defaults to link for the home directory and copy for projects', () => {
    assert.strictEqual(defaultPlacementMode(os.homedir()), 'link');
    assert.strictEqual(defaultPlacementMode(PROJECT_DIR), 'copy');
  });

  it('creates a symlink to the catalog in link mode', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');

    const dest = getSkillDir(PROJECT_DIR, 'claude', SKILL_ID);
    const stat = await fs.lstat(dest);
    assert.ok(stat.isSymbolicLink());
    assert.strictEqual(await fs.readlink(dest), sourceDir);

    // Content is readable through the link, including subdirectories.
    const body = await fs.readFile(path.join(dest, 'references', 'notes.md'), 'utf8');
    assert.strictEqual(body, 'notes\n');
  });

  it('copies the whole directory in copy mode', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'copy');

    const dest = getSkillDir(PROJECT_DIR, 'claude', SKILL_ID);
    const stat = await fs.lstat(dest);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.ok(await fs.readFile(path.join(dest, 'references', 'notes.md'), 'utf8'));
  });

  it('replaces an existing copy when switching to link mode', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'copy');
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');

    const dest = getSkillDir(PROJECT_DIR, 'claude', SKILL_ID);
    assert.ok((await fs.lstat(dest)).isSymbolicLink());
  });

  it('removing a linked skill deletes only the link, never the catalog', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');

    await removeSkillFromConfig(PROJECT_DIR, 'claude', SKILL_ID);

    await assert.rejects(fs.lstat(getSkillDir(PROJECT_DIR, 'claude', SKILL_ID)));
    // The catalog source must survive untouched.
    assert.ok(await fs.readFile(path.join(sourceDir, 'SKILL.md'), 'utf8'));
    assert.ok(await fs.readFile(path.join(sourceDir, 'references', 'notes.md'), 'utf8'));
  });

  it('re-linking over an existing link does not delete the catalog', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');

    assert.ok(await fs.readFile(path.join(sourceDir, 'references', 'notes.md'), 'utf8'));
  });

  it('reports linked, copy-current, copy-stale, broken-link and missing states', async () => {
    const sourceDir = await writeCatalogSkill();

    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, sourceDir)).state,
      'missing'
    );

    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');
    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, sourceDir)).state,
      'linked'
    );

    await copySkillDirToConfig(PROJECT_DIR, 'codex', SKILL_ID, sourceDir, 'copy');
    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'codex', SKILL_ID, sourceDir)).state,
      'copy-current'
    );

    // Catalog moves ahead of the copy.
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: demo-skill\n---\n\nupdated\n');
    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'codex', SKILL_ID, sourceDir)).state,
      'copy-stale'
    );
    // The link is unaffected by definition.
    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, sourceDir)).state,
      'linked'
    );

    await fs.rm(sourceDir, { recursive: true, force: true });
    assert.strictEqual(
      (await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, sourceDir)).state,
      'broken-link'
    );
  });

  it('reports unlinked when the catalog has no matching skill', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'copy');

    const placement = await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, undefined);
    assert.strictEqual(placement.state, 'unlinked');
  });

  it('digests change when any file in the skill changes', async () => {
    const sourceDir = await writeCatalogSkill();
    const before = await digestSkillDir(sourceDir);

    await fs.writeFile(path.join(sourceDir, 'references', 'notes.md'), 'different\n');
    const after = await digestSkillDir(sourceDir);

    assert.notStrictEqual(before, after);

    // Adding a file changes it too.
    await fs.writeFile(path.join(sourceDir, 'extra.md'), 'x\n');
    assert.notStrictEqual(after, await digestSkillDir(sourceDir));
  });

  it('digests are stable across identical copies in different locations', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'copy');

    assert.strictEqual(
      await digestSkillDir(sourceDir),
      await digestSkillDir(getSkillDir(PROJECT_DIR, 'claude', SKILL_ID))
    );
  });
});

describe('Linked catalog entries (development repositories)', () => {
  const DEV_DIR = path.join(TEST_DIR, 'dev-repo', 'demo-skill');

  it('digests a linked directory the same as a copy of its contents', async () => {
    // A skill linked into the catalog from a development repository must hash
    // to the same value as a plain copy, or identical content reads as drifted.
    await fs.mkdir(path.join(DEV_DIR, 'references'), { recursive: true });
    await fs.writeFile(path.join(DEV_DIR, 'SKILL.md'), '---\nname: demo-skill\n---\n\nbody\n');
    await fs.writeFile(path.join(DEV_DIR, 'references', 'notes.md'), 'notes\n');

    const linkDir = path.join(TEST_DIR, 'catalog-link');
    await fs.mkdir(linkDir, { recursive: true });
    const linked = path.join(linkDir, 'demo-skill');
    await fs.symlink(DEV_DIR, linked);

    assert.strictEqual(await digestSkillDir(linked), await digestSkillDir(DEV_DIR));
  });

  it('follows a symlinked file inside a skill directory', async () => {
    const skillDir = path.join(TEST_DIR, 'partial-link');
    await fs.mkdir(skillDir, { recursive: true });
    const realFile = path.join(TEST_DIR, 'real-SKILL.md');
    await fs.writeFile(realFile, 'linked content\n');
    await fs.symlink(realFile, path.join(skillDir, 'SKILL.md'));

    const plainDir = path.join(TEST_DIR, 'plain');
    await fs.mkdir(plainDir, { recursive: true });
    await fs.writeFile(path.join(plainDir, 'SKILL.md'), 'linked content\n');

    assert.strictEqual(await digestSkillDir(skillDir), await digestSkillDir(plainDir));
  });

  it('reports copy-current for a copy of a linked catalog entry', async () => {
    await fs.mkdir(DEV_DIR, { recursive: true });
    await fs.writeFile(path.join(DEV_DIR, 'SKILL.md'), '---\nname: demo-skill\n---\n\nbody\n');

    const catalogDir = path.join(TEST_DIR, 'catalog2');
    await fs.mkdir(catalogDir, { recursive: true });
    const catalogEntry = path.join(catalogDir, SKILL_ID);
    await fs.symlink(DEV_DIR, catalogEntry);

    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, catalogEntry, 'copy');

    const placement = await inspectSkillPlacement(PROJECT_DIR, 'claude', SKILL_ID, catalogEntry);
    assert.strictEqual(placement.state, 'copy-current');
  });

  it('survives a symlink loop without hanging', async () => {
    const loopDir = path.join(TEST_DIR, 'loop');
    await fs.mkdir(loopDir, { recursive: true });
    await fs.writeFile(path.join(loopDir, 'SKILL.md'), 'x\n');
    await fs.symlink(loopDir, path.join(loopDir, 'self'));

    assert.ok(await digestSkillDir(loopDir));
  });
});

describe('Stable link targets', () => {
  it('points a link at the state directory when it leads to the same content', async () => {
    // ~/.acm/skills/<id> is a fixed address in front of a movable catalog.
    // Distributions should hold that address, not the catalog's current path.
    const home = os.homedir();
    const stateSkills = path.join(home, '.acm', 'skills');

    let entrance: string;
    try {
      entrance = await fs.realpath(stateSkills);
    } catch {
      return; // No state directory on this machine; nothing to assert.
    }

    const catalogSkill = path.join(entrance, 'link-target-probe');
    await fs.mkdir(catalogSkill, { recursive: true });
    await fs.writeFile(path.join(catalogSkill, 'SKILL.md'), '---\nname: probe\n---\n\nx\n');

    try {
      await copySkillDirToConfig(PROJECT_DIR, 'claude', 'link-target-probe', catalogSkill, 'link');

      const link = await fs.readlink(getSkillDir(PROJECT_DIR, 'claude', 'link-target-probe'));
      assert.strictEqual(link, path.join(stateSkills, 'link-target-probe'));
    } finally {
      await fs.rm(catalogSkill, { recursive: true, force: true });
    }
  });

  it('falls back to the source path when the state directory differs', async () => {
    const sourceDir = await writeCatalogSkill();
    await copySkillDirToConfig(PROJECT_DIR, 'claude', SKILL_ID, sourceDir, 'link');

    const link = await fs.readlink(getSkillDir(PROJECT_DIR, 'claude', SKILL_ID));
    assert.strictEqual(link, path.resolve(sourceDir));
  });
});
