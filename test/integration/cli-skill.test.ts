// Integration tests for Skill CLI commands

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');

// Test directories
const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'acm-test-skill-project');
const TEST_HOME_DIR = path.join(os.tmpdir(), 'acm-test-skill-home');

async function writeNativeConfigPlaceholders(root: string): Promise<void> {
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.mkdir(path.join(root, '.agents'), { recursive: true });
  await fs.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
  await fs.writeFile(path.join(root, '.codex', 'config.toml'), '# Test Codex config\n');
  await fs.writeFile(path.join(root, '.agents', 'mcp_config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
}

describe('Skill CLI Integration Tests', () => {
  let originalHome: string | undefined;
  let originalCwd: string | undefined;
  let childEnv: NodeJS.ProcessEnv;

  before(async () => {
    originalHome = process.env.HOME;
    originalCwd = process.cwd();

    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.rm(TEST_HOME_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });
    await fs.mkdir(TEST_HOME_DIR, { recursive: true });

    await writeNativeConfigPlaceholders(TEST_PROJECT_DIR);
    await writeNativeConfigPlaceholders(TEST_HOME_DIR);

    childEnv = { ...process.env, HOME: TEST_HOME_DIR };

    // Seed the global catalog (under TEST_HOME_DIR/.acm) with a multi-file skill
    // (SKILL.md + references/ + agents/), reproducing issue #3's precondition.
    process.env.HOME = TEST_HOME_DIR;
    const { addSkillFromDir } = await import('../../src/catalog.js');

    const richSkillSource = path.join(TEST_HOME_DIR, 'rich-skill-source');
    await fs.mkdir(path.join(richSkillSource, 'references'), { recursive: true });
    await fs.mkdir(path.join(richSkillSource, 'agents'), { recursive: true });
    await fs.writeFile(
      path.join(richSkillSource, 'SKILL.md'),
      '---\nname: rich-skill\ndescription: Skill with extra files\n---\n\n# rich-skill\n'
    );
    await fs.writeFile(path.join(richSkillSource, 'references', 'guide.md'), '# Reference guide');
    await fs.writeFile(path.join(richSkillSource, 'agents', 'agent.md'), '# Agent notes');

    await addSkillFromDir('rich-skill', richSkillSource);

    // A second, single-file skill dedicated to the -H destination test, so it
    // doesn't share state with the rich-skill directory-copy assertions above.
    const { normalizeSkillPackage, addSkill } = await import('../../src/catalog.js');
    const homeTargetContent = '---\nname: home-target-skill\ndescription: for -H destination test\n---\n\n# home-target-skill\n';
    await addSkill(normalizeSkillPackage('home-target-skill', homeTargetContent), homeTargetContent);

    process.chdir(TEST_PROJECT_DIR);
  });

  after(async () => {
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.rm(TEST_HOME_DIR, { recursive: true, force: true });
  });

  describe('Skill Add Command (#3: copy the whole skill directory)', () => {
    it('copies SKILL.md and its subdirectories (references/, agents/) to each target', async () => {
      const { stdout, stderr } = await execAsync(
        `node "${CLI_PATH}" skill add rich-skill --targets claude,codex,antigravity`,
        { cwd: TEST_PROJECT_DIR, env: childEnv }
      );

      assert.ok(
        stdout.includes('Added to claude') || stderr.includes('Added to claude'),
        'Should confirm addition to Claude'
      );

      for (const skillsSubdir of [
        path.join('.claude', 'skills'),
        path.join('.codex', 'skills'),
        path.join('.agents', 'skills'),
      ]) {
        const destDir = path.join(TEST_PROJECT_DIR, skillsSubdir, 'rich-skill');
        const skillMd = await fs.readFile(path.join(destDir, 'SKILL.md'), 'utf8');
        assert.match(skillMd, /name: rich-skill/);

        const reference = await fs.readFile(path.join(destDir, 'references', 'guide.md'), 'utf8');
        assert.strictEqual(reference, '# Reference guide');

        const agent = await fs.readFile(path.join(destDir, 'agents', 'agent.md'), 'utf8');
        assert.strictEqual(agent, '# Agent notes');
      }
    });
  });

  describe('Skill Add Command (#4: -H targets home dir from a project cwd)', () => {
    it('installs to the home directory (not the project cwd) and prints the destination path', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" skill add home-target-skill --targets claude -H`,
        { cwd: TEST_PROJECT_DIR, env: childEnv }
      );

      assert.match(stdout, /Added to claude: home-target-skill -> ~[\\/]\.claude[\\/]skills[\\/]home-target-skill/);

      const homeDest = path.join(TEST_HOME_DIR, '.claude', 'skills', 'home-target-skill', 'SKILL.md');
      await assert.doesNotReject(fs.access(homeDest), 'Skill should be installed under the home directory');

      // Ensure it was NOT installed under the project cwd (the pre-fix bug).
      const projectDest = path.join(TEST_PROJECT_DIR, '.claude', 'skills', 'home-target-skill');
      await assert.rejects(fs.access(projectDest), 'Skill should not leak into the project cwd when -H is passed');
    });
  });

  describe('Skill List Command (#5: symlinked skills should show as installed)', () => {
    it('reports a symlinked skill directory under home as enabled with -H', async () => {
      const externalDir = path.join(TEST_HOME_DIR, 'external-linked-skill');
      await fs.mkdir(externalDir, { recursive: true });
      await fs.writeFile(
        path.join(externalDir, 'SKILL.md'),
        '---\nname: linked-skill\ndescription: symlinked skill\n---\n\n# linked-skill\n'
      );

      const homeSkillsDir = path.join(TEST_HOME_DIR, '.claude', 'skills');
      await fs.mkdir(homeSkillsDir, { recursive: true });
      await fs.symlink(externalDir, path.join(homeSkillsDir, 'linked-skill'), 'dir');

      const { stdout } = await execAsync(`node "${CLI_PATH}" skill list -H --verbose`, {
        cwd: TEST_PROJECT_DIR,
        env: childEnv,
      });

      assert.match(stdout, /Skill: linked-skill/);
      assert.match(stdout, /Enabled/);
    });
  });
});
