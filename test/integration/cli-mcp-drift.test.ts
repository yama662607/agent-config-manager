import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TEST_DIR = path.join(os.tmpdir(), 'acm-mcp-drift-test');
const CATALOG = path.join(TEST_DIR, 'catalog');
const PROJECT = path.join(TEST_DIR, 'project');
const CLI = path.resolve('src/cli.ts');

async function acm(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
      cwd: PROJECT,
      env: { ...process.env, ACM_CATALOG_DIR: CATALOG, NODE_ENV: 'test' },
    });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

/** A catalog holding one stdio server. */
async function writeCatalog(): Promise<void> {
  await fs.mkdir(CATALOG, { recursive: true });
  await fs.writeFile(
    path.join(CATALOG, 'catalog.toml'),
    [
      'version = "1.0"',
      '',
      '[mcps.demo-server]',
      'id = "demo-server"',
      'displayName = "Demo"',
      'description = "demo server"',
      'addedAt = "2026-08-02T00:00:00.000Z"',
      '[mcps.demo-server.recipe]',
      'command = "npx"',
      'args = ["-y", "@demo/server"]',
      '',
    ].join('\n')
  );
}

describe('MCP drift detection', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(PROJECT, { recursive: true });
    await writeCatalog();
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('reports synced when the configuration matches the catalog', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    const status = await acm(['mcp', '--json']);
    const parsed = JSON.parse(status);
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.state.claude, 'synced');
    assert.strictEqual(server.source, 'catalog');
  });

  it('reports differs when the command was changed by hand', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    const configPath = path.join(PROJECT, '.mcp.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.mcpServers['demo-server'].args = ['-y', '@demo/server@0.0.1'];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.state.claude, 'differs');
  });

  it('reports inline for a server absent from the catalog', async () => {
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify(
        { mcpServers: { 'hand-written': { type: 'stdio', command: 'node', args: ['x.js'] } } },
        null,
        2
      )
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'hand-written');
    assert.strictEqual(server.state.claude, 'inline');
    assert.strictEqual(server.source, 'inline');
  });

  it('matches a catalog entry by what the server launches, not only by name', async () => {
    // A catalog entry is keyed by package id, but Codex and Claude reject
    // `@scope/name` as a server name, so what lands in a provider's config is a
    // sanitized form -- or, from another tool, the full id. Matching on the
    // name alone reported `@yama662607/obsidian-companion-mcp` as unmanaged
    // while its catalog entry sat right there.
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          // The catalog calls this `demo-server`.
          '@demo/server': { type: 'stdio', command: 'npx', args: ['-y', '@demo/server'] },
        },
      })
    );

    // Reported under the catalog's name, not the key the config happens to
    // use: the two are the same server, and showing both split one row in two.
    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.source, 'catalog');
    assert.strictEqual(server.state.claude, 'synced');
  });

  it('still reports a genuinely unknown server as inline', async () => {
    // The fallbacks must not match anything that merely looks similar.
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'other-server': { type: 'stdio', command: 'npx', args: ['-y', '@other/thing'] },
        },
      })
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'other-server');
    assert.strictEqual(server.source, 'inline');
  });

  it('picks the entry whose recipe matches when several install one package', async () => {
    // Two catalog entries can launch the same package -- the catalog here has
    // picked up both a package-id-keyed and a sanitized-name-keyed copy. The
    // matching one must win, or the report invents a `differs`.
    await fs.appendFile(
      path.join(CATALOG, 'catalog.toml'),
      [
        '[mcps.demo_server]',
        'id = "demo_server"',
        'displayName = "Demo (old)"',
        'description = "same package, older pin"',
        'addedAt = "2026-08-02T00:00:00.000Z"',
        '[mcps.demo_server.recipe]',
        'command = "npx"',
        'args = ["-y", "@demo/server@0.0.1"]',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          '@demo/server': { type: 'stdio', command: 'npx', args: ['-y', '@demo/server'] },
        },
      })
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.state.claude, 'synced');
  });

  it('names the plugin that owns a server, rather than calling it inline', async () => {
    // A server a plugin brings is the plugin's to manage: installing writes it
    // and uninstalling removes it. Calling it inline invited a pointless
    // `acm mcp adopt`, and the next plugin install would put it back anyway.
    await fs.mkdir(path.join(CATALOG, 'plugins', 'demo-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(CATALOG, 'plugins', 'demo-plugin', '.mcp.json'),
      JSON.stringify({ mcpServers: { 'plugin-server': { command: 'npx', args: ['-y', 'x'] } } })
    );
    await fs.writeFile(
      path.join(CATALOG, 'plugins-metadata.toml'),
      [
        'version = "1.0"',
        '',
        '[plugins.demo-plugin]',
        'name = "demo-plugin"',
        'sourcePath = "/nowhere"',
        'agent = "claude"',
        'installedAt = "2026-01-01T00:00:00.000Z"',
        'updatedAt = "2026-01-01T00:00:00.000Z"',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify({
        mcpServers: { 'plugin-server': { type: 'stdio', command: 'npx', args: ['-y', 'x'] } },
      })
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'plugin-server');
    assert.strictEqual(server.state.claude, 'plugin');
    assert.strictEqual(server.source, 'plugin');
    assert.strictEqual(server.plugin, 'demo-plugin');
  });

  it('lists disabled servers instead of hiding them', async () => {
    // A disabled server used to vanish from status, leaving no way to see it.
    // A plain command is used here because Codex entries launched through npx
    // are reported under the package id they install, not the table name.
    await fs.mkdir(path.join(PROJECT, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(PROJECT, '.codex', 'config.toml'),
      '[mcp_servers.demo-server]\ncommand = "node"\nargs = ["server.js"]\nenabled = false\n'
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.ok(server, 'a disabled server must still be listed');
    assert.strictEqual(server.state.codex, 'disabled');
    assert.strictEqual(server.enabled, false);
  });

  it('exposes the recipe each target actually launches', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.deployed.claude.command, 'npx');
    assert.deepStrictEqual(server.deployed.claude.args, ['-y', '@demo/server']);
  });

  it('re-applies the catalog recipe with update', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    const configPath = path.join(PROJECT, '.mcp.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.mcpServers['demo-server'].args = ['-y', '@demo/server@0.0.1'];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const output = await acm(['mcp', 'update', 'demo-server', '-t', 'claude']);
    assert.match(output, /Updated claude: demo-server/);

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.state.claude, 'synced');
  });

  it('refuses to overwrite an inline server, which has no catalog recipe', async () => {
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify(
        { mcpServers: { 'hand-written': { type: 'stdio', command: 'node', args: ['x.js'] } } },
        null,
        2
      )
    );

    const output = await acm(['mcp', 'update', 'hand-written', '-t', 'claude']);
    assert.match(output, /Not in the catalog/);

    const config = JSON.parse(await fs.readFile(path.join(PROJECT, '.mcp.json'), 'utf8'));
    assert.deepStrictEqual(config.mcpServers['hand-written'].args, ['x.js']);
  });
});

describe('Codex remote server field', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(PROJECT, { recursive: true });
    await writeCatalog();
  });

  it('writes url, the field Codex reads', async () => {
    await acm([
      'mcp', 'add', 'remote-server', '-t', 'codex',
      '--url', 'https://mcp.example.com/mcp', '--no-register',
    ]);

    const raw = await fs.readFile(path.join(PROJECT, '.codex', 'config.toml'), 'utf8');
    assert.match(raw, /url = "https:\/\/mcp\.example\.com\/mcp"/);
    assert.doesNotMatch(raw, /httpUrl/);
  });

  it('still reads httpUrl written by older versions', async () => {
    await fs.mkdir(path.join(PROJECT, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(PROJECT, '.codex', 'config.toml'),
      '[mcp_servers.legacy-remote]\nhttpUrl = "https://old.example.com/mcp"\n'
    );

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'legacy-remote');
    assert.strictEqual(server.deployed.codex.url, 'https://old.example.com/mcp');
  });
});

describe('Adopting a target configuration into the catalog', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(PROJECT, { recursive: true });
    await writeCatalog();
  });

  it('replaces a stale catalog recipe with what the target launches', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    // The deployed side is corrected in place — an application moved, a package
    // gained a version suffix — and the catalog must be able to follow.
    const configPath = path.join(PROJECT, '.mcp.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.mcpServers['demo-server'].args = ['-y', '@demo/server@2.0.0'];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const output = await acm(['mcp', 'adopt', 'demo-server', '-t', 'claude']);
    assert.match(output, /Adopted into the catalog: demo-server/);

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'demo-server');
    assert.strictEqual(server.state.claude, 'synced');
  });

  it('adopts a server that was configured inline', async () => {
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify(
        { mcpServers: { 'hand-written': { type: 'stdio', command: 'node', args: ['x.js'] } } },
        null,
        2
      )
    );

    await acm(['mcp', 'adopt', 'hand-written', '-t', 'claude']);

    const parsed = JSON.parse(await acm(['mcp', '--json']));
    const server = parsed.servers.find((s: any) => s.name === 'hand-written');
    assert.strictEqual(server.source, 'catalog');
  });

  it('warns when the adopted recipe carries a machine-specific path', async () => {
    const personal = ['', 'Users', 'someone', 'output'].join('/');
    await fs.writeFile(
      path.join(PROJECT, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            'path-bound': { type: 'stdio', command: 'node', args: [`--out=${personal}`] },
          },
        },
        null,
        2
      )
    );

    const output = await acm(['mcp', 'adopt', 'path-bound', '-t', 'claude']);
    assert.match(output, /machine-specific path/);
    // Warned, not refused: the user configured it deliberately.
    assert.match(output, /Adopted into the catalog/);
  });

  it('requires exactly one target, since adopting picks a winner', async () => {
    const output = await acm(['mcp', 'adopt', 'demo-server', '-t', 'claude,codex']);
    assert.match(output, /exactly one is required/);
  });

  it('leaves servers alone when nothing differs', async () => {
    await acm(['mcp', 'add', 'demo-server', '-t', 'claude', '--no-register']);

    const output = await acm(['mcp', 'adopt', '-t', 'claude']);
    assert.match(output, /Nothing to adopt/);
  });
});
