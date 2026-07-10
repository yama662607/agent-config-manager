// Unit tests for skill-adapters operations

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  copySkillDirToConfig,
  getSkills,
  getSkillDir,
} from '../../src/skill-adapters.js';

const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'acm-test-skill-adapters');

describe('Skill Adapters Module', () => {
  beforeEach(async () => {
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
  });

  describe('copySkillDirToConfig (#3: skill add should copy the whole skill directory)', () => {
    it('copies SKILL.md plus subdirectories like references/ and agents/', async () => {
      const sourceDir = path.join(TEST_PROJECT_DIR, 'source-skill');
      await fs.mkdir(path.join(sourceDir, 'references'), { recursive: true });
      await fs.mkdir(path.join(sourceDir, 'agents'), { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: my-skill\n---\ncontent');
      await fs.writeFile(path.join(sourceDir, 'references', 'guide.md'), 'reference content');
      await fs.writeFile(path.join(sourceDir, 'agents', 'agent.md'), 'agent content');

      await copySkillDirToConfig(TEST_PROJECT_DIR, 'claude', 'my-skill', sourceDir);

      const destDir = getSkillDir(TEST_PROJECT_DIR, 'claude', 'my-skill');
      const skillMd = await fs.readFile(path.join(destDir, 'SKILL.md'), 'utf8');
      const reference = await fs.readFile(path.join(destDir, 'references', 'guide.md'), 'utf8');
      const agent = await fs.readFile(path.join(destDir, 'agents', 'agent.md'), 'utf8');

      assert.match(skillMd, /name: my-skill/);
      assert.strictEqual(reference, 'reference content');
      assert.strictEqual(agent, 'agent content');
    });
  });

  describe('getSkills (#5: symlinked skill directories should be detected)', () => {
    it('detects a symlinked skill directory as installed', async () => {
      const skillsDir = path.join(TEST_PROJECT_DIR, '.claude', 'skills');
      await fs.mkdir(skillsDir, { recursive: true });

      const realSkillTarget = path.join(TEST_PROJECT_DIR, 'external-skill');
      await fs.mkdir(realSkillTarget, { recursive: true });
      await fs.writeFile(path.join(realSkillTarget, 'SKILL.md'), '---\nname: linked-skill\n---\ncontent');

      await fs.symlink(realSkillTarget, path.join(skillsDir, 'linked-skill'), 'dir');

      const skills = await getSkills(TEST_PROJECT_DIR, 'claude');

      assert.ok(skills['linked-skill']?.enabled, 'Symlinked skill should be reported as enabled/installed');
    });

    it('still detects regular (non-symlinked) skill directories', async () => {
      const skillsDir = path.join(TEST_PROJECT_DIR, '.claude', 'skills', 'regular-skill');
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'SKILL.md'), '---\nname: regular-skill\n---\ncontent');

      const skills = await getSkills(TEST_PROJECT_DIR, 'claude');

      assert.ok(skills['regular-skill']?.enabled);
    });

    it('skips broken symlinks without throwing', async () => {
      const skillsDir = path.join(TEST_PROJECT_DIR, '.claude', 'skills');
      await fs.mkdir(skillsDir, { recursive: true });

      await fs.symlink(path.join(TEST_PROJECT_DIR, 'does-not-exist'), path.join(skillsDir, 'broken-link'), 'dir');

      const skills = await getSkills(TEST_PROJECT_DIR, 'claude');

      assert.strictEqual(skills['broken-link'], undefined);
    });
  });
});
