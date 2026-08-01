import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-catalog-search-test');
const CLI = path.resolve('src/cli.ts');

async function acm(args: string[]): Promise<string> {
  const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
    env: { ...process.env, ACM_CATALOG_DIR: TEST_DIR, NODE_ENV: 'test' },
  });
  return stdout + stderr;
}

async function writeSkill(name: string, description: string): Promise<void> {
  const dir = path.join(TEST_DIR, 'skills', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`);
}

describe('Catalog search filter', () => {
  before(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await writeSkill('alpha-tool', 'does alpha things');
    await writeSkill('beta-tool', 'handles beta workflows');
    await writeSkill('gamma', 'unrelated helper');
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('narrows the list instead of returning everything', async () => {
    // Regression: --search was parsed but never applied, so every entry came back.
    const all = await acm(['skill', 'list', '-g']);
    assert.match(all, /3 entries/);

    const narrowed = await acm(['skill', 'list', '-g', '--search', 'beta']);
    assert.match(narrowed, /1 entries/);
    assert.match(narrowed, /beta-tool/);
    assert.doesNotMatch(narrowed, /alpha-tool/);
  });

  it('matches descriptions, not just names', async () => {
    const byDescription = await acm(['skill', 'list', '-g', '--search', 'workflows']);
    assert.match(byDescription, /beta-tool/);
  });

  it('is case-insensitive', async () => {
    const upper = await acm(['skill', 'list', '-g', '--search', 'BETA']);
    assert.match(upper, /beta-tool/);
  });

  it('reports no match rather than listing everything', async () => {
    const none = await acm(['skill', 'list', '-g', '--search', 'zzzznope']);
    assert.match(none, /No matching skill entries \(search=zzzznope\)/);
    assert.doesNotMatch(none, /alpha-tool/);
  });

  it('applies to the MCP catalog too', async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'catalog.toml'),
      [
        'version = "1.0"',
        '',
        '[mcps.searchable-server]',
        'id = "searchable-server"',
        'displayName = "Searchable Server"',
        'description = "a findable server"',
        'addedAt = "2026-08-02T00:00:00.000Z"',
        '[mcps.searchable-server.recipe]',
        'command = "npx"',
        '',
        '[mcps.other-server]',
        'id = "other-server"',
        'displayName = "Other"',
        'description = "unrelated"',
        'addedAt = "2026-08-02T00:00:00.000Z"',
        '[mcps.other-server.recipe]',
        'command = "npx"',
        '',
      ].join('\n')
    );

    const narrowed = await acm(['mcp', 'list', '-g', '--search', 'findable']);
    assert.match(narrowed, /searchable-server/);
    assert.doesNotMatch(narrowed, /other-server/);
  });
});
