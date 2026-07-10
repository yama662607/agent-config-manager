// Unit tests for skill-adapters operations

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  copySkillDirToConfig,
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
});
