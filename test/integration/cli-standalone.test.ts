import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-standalone-test');
const FAKE_HOME = path.join(TEST_DIR, 'home');
const PROJECT = path.join(TEST_DIR, 'project');
const CLI = path.resolve('src/cli.ts');

/**
 * A first-run environment: an empty home, no config file, no catalog anywhere
 * else. Everything must work from `~/.acm` alone.
 */
async function acm(args: string[]): Promise<string> {
  const env = { ...process.env, HOME: FAKE_HOME, NODE_ENV: 'test' };
  delete env.ACM_CATALOG_DIR;

  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], { cwd: PROJECT, env });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

describe('Working from ~/.acm alone', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(FAKE_HOME, { recursive: true });
    await fs.mkdir(PROJECT, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('defaults the catalog to the state directory', async () => {
    const output = await acm(['doctor', '-H']);
    assert.match(output, /default \(state directory\)/);
  });

  it('distributes a skill with no catalog configured', async () => {
    const skillDir = path.join(FAKE_HOME, '.acm', 'skills', 'hello-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: hello-skill\ndescription: probe\n---\n\nbody\n'
    );

    const output = await acm(['skill', 'add', 'hello-skill', '-t', 'claude,codex', '-H']);
    assert.match(output, /Added to claude/);

    // With no separate catalog, a link points straight at ~/.acm — no indirection.
    const link = await fs.readlink(path.join(FAKE_HOME, '.claude', 'skills', 'hello-skill'));
    assert.strictEqual(link, path.join(FAKE_HOME, '.acm', 'skills', 'hello-skill'));
  });

  it('configures an MCP server for every target', async () => {
    await acm(['mcp', 'add', '@modelcontextprotocol/server-github', '-t', 'claude,codex,agy,grok', '-H']);

    const parsed = JSON.parse(await acm(['mcp', '-H', '--json']));
    const server = parsed.servers.find((s: any) => s.name.includes('server-github'));
    assert.ok(server, 'the server must be listed');
    assert.strictEqual(server.state.claude, 'synced');
  });

  it('imports a plugin into the catalog and installs it', async () => {
    // A plugin obtained from anywhere must be able to enter an empty catalog.
    const pluginDir = path.join(TEST_DIR, 'incoming', 'demo-plugin');
    await fs.mkdir(path.join(pluginDir, '.claude-plugin'), { recursive: true });
    await fs.mkdir(path.join(pluginDir, 'skills', 'demo-skill'), { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo-plugin', version: '1.0.0', description: 'probe' })
    );
    await fs.writeFile(
      path.join(pluginDir, 'skills', 'demo-skill', 'SKILL.md'),
      '---\nname: demo-skill\ndescription: from plugin\n---\n\nbody\n'
    );

    const imported = await acm(['plugin', 'import', pluginDir]);
    assert.match(imported, /Imported into the catalog: demo-plugin \(1 skill/);

    const listed = await acm(['plugin', 'list']);
    assert.match(listed, /demo-plugin/);

    const installed = await acm(['plugin', 'install', 'demo-plugin', '-t', 'codex']);
    assert.match(installed, /Copying plugin/);

    // The guard used to test a field present on every entry, so nothing was
    // ever copied. Check the files actually landed.
    await fs.access(
      path.join(FAKE_HOME, '.codex', '.tmp', 'plugins', 'plugins', 'demo-plugin', 'skills', 'demo-skill', 'SKILL.md')
    );
  });

  it('skips only the targets a plugin is already installed for', async () => {
    const pluginDir = path.join(TEST_DIR, 'incoming2', 'twice-plugin');
    await fs.mkdir(path.join(pluginDir, '.claude-plugin'), { recursive: true });
    await fs.mkdir(path.join(pluginDir, 'skills', 'twice-skill'), { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'twice-plugin', version: '1.0.0' })
    );
    await fs.writeFile(
      path.join(pluginDir, 'skills', 'twice-skill', 'SKILL.md'),
      '---\nname: twice-skill\ndescription: probe\n---\n\nbody\n'
    );

    await acm(['plugin', 'import', pluginDir]);
    await acm(['plugin', 'install', 'twice-plugin', '-t', 'codex']);

    // A different target must still install.
    const second = await acm(['plugin', 'install', 'twice-plugin', '-t', 'claude']);
    assert.match(second, /Copying plugin/);

    // The same target must not.
    const third = await acm(['plugin', 'install', 'twice-plugin', '-t', 'codex']);
    assert.match(third, /Already installed/);
  });
});
