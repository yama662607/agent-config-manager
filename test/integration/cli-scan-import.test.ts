import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-scan-import-test');
const FAKE_HOME = path.join(TEST_DIR, 'home');
const CATALOG = path.join(TEST_DIR, 'catalog');
const CLI = path.resolve('src/cli.ts');

async function acm(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
      env: { ...process.env, HOME: FAKE_HOME, ACM_CATALOG_DIR: CATALOG, NODE_ENV: 'test' },
    });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

describe('acm scan imports whole skill directories', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(CATALOG, { recursive: true });

    // A skill installed for Claude that carries supporting files.
    const skillDir = path.join(FAKE_HOME, '.claude', 'skills', 'rich-skill');
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
    await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: rich-skill\ndescription: has extras\n---\n\nbody\n'
    );
    await fs.writeFile(path.join(skillDir, 'references', 'guide.md'), 'guide\n');
    await fs.writeFile(path.join(skillDir, 'scripts', 'run.sh'), '#!/bin/bash\necho hi\n');
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('copies references and scripts, not just SKILL.md', async () => {
    const output = await acm(['scan', '--skills-only']);
    assert.match(output, /rich-skill/);

    const imported = path.join(CATALOG, 'skills', 'rich-skill');
    await fs.access(path.join(imported, 'SKILL.md'));
    // The whole point: supporting files must survive the import.
    assert.strictEqual(await fs.readFile(path.join(imported, 'references', 'guide.md'), 'utf8'), 'guide\n');
    await fs.access(path.join(imported, 'scripts', 'run.sh'));
  });

  it('does not import on a dry run', async () => {
    await acm(['scan', '--skills-only', '--dry-run']);
    await assert.rejects(fs.access(path.join(CATALOG, 'skills', 'rich-skill')));
  });

  it('skips skills already in the catalog', async () => {
    await acm(['scan', '--skills-only']);
    const second = await acm(['scan', '--skills-only']);
    assert.doesNotMatch(second, /✅ rich-skill/);
  });
});
