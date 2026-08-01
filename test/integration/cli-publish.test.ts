import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-publish-test');
const CATALOG = path.join(TEST_DIR, 'catalog');
const PUBLIC_REPO = path.join(TEST_DIR, 'public-repo');
const CLI = path.resolve('src/cli.ts');

async function acm(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await run('npx', ['tsx', CLI, ...args], {
      env: { ...process.env, ACM_CATALOG_DIR: CATALOG, NODE_ENV: 'test' },
    });
    return { ...result, code: 0 };
  } catch (error: any) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? 1 };
  }
}

async function writeSkill(name: string, body: string): Promise<void> {
  const dir = path.join(CATALOG, 'skills', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\n${body}\n`);
}

describe('acm catalog publish', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(CATALOG, { recursive: true });

    await writeSkill('public-one', 'safe content');
    await writeSkill('private-one', 'internal notes');

    await fs.mkdir(path.join(CATALOG, 'mcp-servers'), { recursive: true });
    await fs.writeFile(path.join(CATALOG, 'mcp-servers', 'demo.toml'), 'command = "npx"\n');
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('stages only allowlisted entries', async () => {
    await fs.writeFile(
      path.join(CATALOG, 'PUBLIC.txt'),
      '# comment\nskill/public-one\nmcp/demo\n'
    );

    const { stdout } = await acm(['catalog', 'publish']);
    assert.match(stdout, /Staged 2 of 2/);

    const stage = path.join(CATALOG, 'dist-public');
    await fs.access(path.join(stage, 'skills', 'public-one', 'SKILL.md'));
    await fs.access(path.join(stage, 'mcp', 'demo.toml'));
    await assert.rejects(fs.access(path.join(stage, 'skills', 'private-one')));
  });

  it('refuses to publish when a secret is present', async () => {
    // Assembled at runtime so this fixture is not itself a literal secret in the repo.
    const fakeToken = ['ghp', 'AbCdEfGhIjKlMnOpQrStUvWx0123456789'].join('_');
    await writeSkill('public-one', `token: ${fakeToken}`);
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');

    const { stdout, stderr } = await acm(['catalog', 'publish']);
    assert.match(stdout + stderr, /possible secrets/i);
    assert.match(stdout + stderr, /GitHub token/);
  });

  it('refuses to publish when a personal path is present', async () => {
    const fakePath = ['', 'Users', 'someone', 'notes.md'].join('/');
    await writeSkill('public-one', `see ${fakePath}`);
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');

    const { stdout, stderr } = await acm(['catalog', 'publish']);
    assert.match(stdout + stderr, /personal paths/i);
  });

  it('allows the documentation placeholder /Users/username', async () => {
    await writeSkill('public-one', 'example path: /Users/username/.acm');
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');

    const { stdout } = await acm(['catalog', 'publish']);
    assert.match(stdout, /No secrets or personal paths/);
  });

  it('applies the publish/bundle overlay', async () => {
    await fs.mkdir(path.join(CATALOG, 'publish', 'bundle', 'docs'), { recursive: true });
    await fs.writeFile(path.join(CATALOG, 'publish', 'bundle', 'README.md'), '# Bundle\n');
    await fs.writeFile(path.join(CATALOG, 'publish', 'bundle', 'docs', 'SETUP.md'), 'setup\n');
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');

    const { stdout } = await acm(['catalog', 'publish']);
    assert.match(stdout, /Applied 2 overlay files/);

    const stage = path.join(CATALOG, 'dist-public');
    assert.strictEqual(await fs.readFile(path.join(stage, 'README.md'), 'utf8'), '# Bundle\n');
    await fs.access(path.join(stage, 'docs', 'SETUP.md'));
  });

  it('reports entries missing from the catalog', async () => {
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\nskill/nonexistent\n');

    const { stdout, stderr } = await acm(['catalog', 'publish']);
    assert.match(stdout, /Staged 1 of 2/);
    assert.match(stderr, /not found in the catalog: skill\/nonexistent/);
  });

  it('syncs into a git working tree only when asked', async () => {
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');
    await fs.mkdir(PUBLIC_REPO, { recursive: true });
    await run('git', ['init', '-q'], { cwd: PUBLIC_REPO });

    // Without --to nothing is written outside the catalog.
    await acm(['catalog', 'publish']);
    await assert.rejects(fs.access(path.join(PUBLIC_REPO, 'skills')));

    await acm(['catalog', 'publish', '--to', PUBLIC_REPO]);
    await fs.access(path.join(PUBLIC_REPO, 'skills', 'public-one', 'SKILL.md'));
  });

  it('leaves the destination .git alone while replacing content', async () => {
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');
    await fs.mkdir(PUBLIC_REPO, { recursive: true });
    await run('git', ['init', '-q'], { cwd: PUBLIC_REPO });
    await fs.writeFile(path.join(PUBLIC_REPO, 'stale-file.md'), 'old\n');

    await acm(['catalog', 'publish', '--to', PUBLIC_REPO]);

    await fs.access(path.join(PUBLIC_REPO, '.git'));
    await assert.rejects(fs.access(path.join(PUBLIC_REPO, 'stale-file.md')));
  });

  it('refuses a destination that is not a git working tree', async () => {
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');
    const plain = path.join(TEST_DIR, 'plain-dir');
    await fs.mkdir(plain, { recursive: true });

    const { stdout, stderr } = await acm(['catalog', 'publish', '--to', plain]);
    assert.match(stdout + stderr, /Not a git working tree/);
  });

  it('does not write to the destination on a dry run', async () => {
    await fs.writeFile(path.join(CATALOG, 'PUBLIC.txt'), 'skill/public-one\n');
    await fs.mkdir(PUBLIC_REPO, { recursive: true });
    await run('git', ['init', '-q'], { cwd: PUBLIC_REPO });

    const { stdout } = await acm(['catalog', 'publish', '--to', PUBLIC_REPO, '--dry-run']);
    assert.match(stdout, /Dry run/);
    await assert.rejects(fs.access(path.join(PUBLIC_REPO, 'skills')));
  });
});
