import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-skill-index-test');
const CATALOG = path.join(TEST_DIR, 'catalog');
const CLI = path.resolve('src/cli.ts');

async function acm(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
      cwd: TEST_DIR,
      env: { ...process.env, ACM_CATALOG_DIR: CATALOG, NODE_ENV: 'test' },
    });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

async function writeSkill(name: string, description: string): Promise<void> {
  const dir = path.join(CATALOG, 'skills', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`
  );
}

async function readCatalog(): Promise<any> {
  return TOML.parse(await fs.readFile(path.join(CATALOG, 'catalog.toml'), 'utf8'));
}

describe('The skill index is derived, not stored', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(CATALOG, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('lists skills found on disk without them being in catalog.toml', async () => {
    await writeSkill('derived-one', 'first');
    await writeSkill('derived-two', 'second');

    const listed = await acm(['skill', 'list', '-g']);
    assert.match(listed, /2 entries/);
    assert.match(listed, /derived-one/);
  });

  it('keeps catalog.toml free of the skill index', async () => {
    await writeSkill('derived-one', 'first');
    // Adding an MCP forces the file to be written.
    await acm(['mcp', 'add', 'probe', '-g', '--command', 'echo', '--args', '["hi"]']);

    const catalog = await readCatalog();
    assert.strictEqual(catalog.skills, undefined, 'the index must not be persisted');
    assert.ok(catalog.mcps.probe, 'MCP recipes have no directory to derive them from');
  });

  it('reflects a frontmatter edit immediately', async () => {
    await writeSkill('derived-one', 'first');
    assert.match(await acm(['skill', 'show', '-g', 'derived-one']), /first/);

    await writeSkill('derived-one', 'rewritten');
    assert.match(await acm(['skill', 'show', '-g', 'derived-one']), /rewritten/);
  });

  it('drops a skill as soon as its directory is gone', async () => {
    await writeSkill('temporary', 'here for now');
    assert.match(await acm(['skill', 'list', '-g']), /temporary/);

    await fs.rm(path.join(CATALOG, 'skills', 'temporary'), { recursive: true });
    assert.doesNotMatch(await acm(['skill', 'list', '-g']), /temporary/);
  });

  it('adopts addedAt from a catalog written by an older version', async () => {
    // The one field the filesystem cannot supply must survive the migration.
    await writeSkill('legacy', 'from before');
    await fs.writeFile(
      path.join(CATALOG, 'catalog.toml'),
      [
        'version = "1.0"',
        '',
        '[skills.legacy]',
        'id = "legacy"',
        'displayName = "legacy"',
        'description = "from before"',
        'path = "skills/legacy"',
        'addedAt = "2020-01-02T03:04:05.000Z"',
        '',
      ].join('\n')
    );

    await acm(['skill', 'list', '-g']);

    const metadata = TOML.parse(
      await fs.readFile(path.join(CATALOG, 'skills-metadata.toml'), 'utf8')
    ) as any;
    assert.strictEqual(metadata.skills.legacy.installedAt, '2020-01-02T03:04:05.000Z');
  });
});
