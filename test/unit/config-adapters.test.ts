import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addMcpToConfig,
  disableMcpInConfig,
  getMcpServers,
  readNativeConfig,
  removeMcpFromConfig,
} from '../../src/config-adapters.js';
import type { McpRecipe } from '../../src/types.js';

const TEST_DIR = path.join(os.tmpdir(), 'acm-config-adapters-test');
const CODEX_CONFIG_PATH = path.join(TEST_DIR, '.codex', 'config.toml');
const CLAUDE_CONFIG_PATH = path.join(TEST_DIR, '.mcp.json');
const ANTIGRAVITY_CONFIG_PATH = path.join(TEST_DIR, '.agents', 'mcp_config.json');
const GROK_CONFIG_PATH = path.join(TEST_DIR, '.grok', 'config.toml');

const GITHUB_RECIPE: McpRecipe = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
};

describe('Config Adapters', () => {
  before(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
    await fs.mkdir(path.dirname(ANTIGRAVITY_CONFIG_PATH), { recursive: true });
    await fs.mkdir(path.dirname(GROK_CONFIG_PATH), { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes Codex MCP entries with a valid identifier key', async () => {
    await fs.writeFile(CODEX_CONFIG_PATH, '# test config\n');

    const actualName = await addMcpToConfig(
      'codex',
      CODEX_CONFIG_PATH,
      '@modelcontextprotocol/server-github',
      GITHUB_RECIPE
    );

    assert.strictEqual(actualName, 'github');

    const raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
    assert.match(raw, /\[mcp_servers\.github\]/);
    assert.ok(!raw.includes('[mcp_servers."@modelcontextprotocol/server-github"]'));

    // Read back under the key the file actually uses. The package id is how
    // you address it (see the next test); it is not what Codex is configured
    // with, and reporting it as the name split one server into two rows in
    // status once a catalog id stopped matching its package.
    const servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.ok(servers['github']);
    assert.strictEqual(servers['@modelcontextprotocol/server-github'], undefined);
  });

  it('can disable and remove a Codex MCP entry by package id', async () => {
    await fs.writeFile(CODEX_CONFIG_PATH, '# test config\n');
    await addMcpToConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github', GITHUB_RECIPE);

    await disableMcpInConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github');

    let servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.strictEqual(servers['github']?.enabled, false);
    // A disabled entry keeps its recipe: it is what pairs the entry with its
    // catalog record, and without it a disabled server read as unmanaged.
    assert.strictEqual(servers['github']?.recipe?.command, GITHUB_RECIPE.command);

    await removeMcpFromConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github');

    servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.deepStrictEqual(servers, {});

    const result = await readNativeConfig('codex', CODEX_CONFIG_PATH);
    assert.deepStrictEqual(result.config, { mcp_servers: {} });
  });

  it('writes Grok MCP entries under mcp_servers with an enabled flag', async () => {
    await fs.writeFile(GROK_CONFIG_PATH, '# test config\n');

    const actualName = await addMcpToConfig(
      'grok',
      GROK_CONFIG_PATH,
      '@modelcontextprotocol/server-github',
      GITHUB_RECIPE
    );

    assert.strictEqual(actualName, 'github');

    const raw = await fs.readFile(GROK_CONFIG_PATH, 'utf8');
    assert.match(raw, /\[mcp_servers\.github\]/);
    assert.match(raw, /enabled = true/);

    const servers = await getMcpServers('grok', GROK_CONFIG_PATH);
    assert.strictEqual(servers['github']?.enabled, true);
  });

  it('can disable and remove a Grok MCP entry by package id', async () => {
    await fs.writeFile(GROK_CONFIG_PATH, '# test config\n');
    await addMcpToConfig('grok', GROK_CONFIG_PATH, '@modelcontextprotocol/server-github', GITHUB_RECIPE);

    await disableMcpInConfig('grok', GROK_CONFIG_PATH, '@modelcontextprotocol/server-github');

    let servers = await getMcpServers('grok', GROK_CONFIG_PATH);
    assert.strictEqual(servers['github']?.enabled, false);

    await removeMcpFromConfig('grok', GROK_CONFIG_PATH, '@modelcontextprotocol/server-github');

    servers = await getMcpServers('grok', GROK_CONFIG_PATH);
    assert.deepStrictEqual(servers, {});
  });

  it('uses url (not httpUrl) for Grok HTTP servers', async () => {
    const httpRecipe: McpRecipe = {
      transport: 'http',
      url: 'https://mcp.example.com/api',
    };

    await fs.writeFile(GROK_CONFIG_PATH, '# test config\n');
    await addMcpToConfig('grok', GROK_CONFIG_PATH, 'remote-api', httpRecipe);

    const raw = await fs.readFile(GROK_CONFIG_PATH, 'utf8');
    assert.match(raw, /url = "https:\/\/mcp\.example\.com\/api"/);
    assert.ok(!raw.includes('httpUrl'));

    const servers = await getMcpServers('grok', GROK_CONFIG_PATH);
    assert.strictEqual(servers['remote-api']?.recipe?.url, 'https://mcp.example.com/api');
    assert.strictEqual(servers['remote-api']?.recipe?.transport, 'http');
  });

  it('preserves unrelated Grok config sections when editing MCP servers', async () => {
    await fs.writeFile(
      GROK_CONFIG_PATH,
      [
        '[cli]',
        'installer = "internal"',
        'auto_update = true',
        '',
        '[ui]',
        'yolo = false',
        '',
        '[[marketplace.sources]]',
        'name = "xAI Official"',
        'git = "https://github.com/xai-org/plugin-marketplace.git"',
        '',
      ].join('\n')
    );

    await addMcpToConfig('grok', GROK_CONFIG_PATH, '@modelcontextprotocol/server-github', GITHUB_RECIPE);

    const result = await readNativeConfig('grok', GROK_CONFIG_PATH);
    assert.strictEqual((result.config as any).cli.installer, 'internal');
    assert.strictEqual((result.config as any).ui.yolo, false);
    assert.strictEqual((result.config as any).marketplace.sources[0].name, 'xAI Official');
    assert.ok((result.config as any).mcp_servers.github);
  });

  it('round-trips env for Claude and Antigravity configs', async () => {
    const recipeWithEnv: McpRecipe = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@yama662607/obsidian-companion-mcp'],
      env: {
        OBSIDIAN_VAULT_PATH: '/vault/main',
      },
    };

    await fs.writeFile(CLAUDE_CONFIG_PATH, JSON.stringify({ mcpServers: {} }, null, 2));
    await fs.writeFile(ANTIGRAVITY_CONFIG_PATH, JSON.stringify({ mcpServers: {} }, null, 2));

    await addMcpToConfig('claude', CLAUDE_CONFIG_PATH, '@yama662607/obsidian-companion-mcp', recipeWithEnv);
    await addMcpToConfig('antigravity', ANTIGRAVITY_CONFIG_PATH, '@yama662607/obsidian-companion-mcp', recipeWithEnv);

    const claudeServers = await getMcpServers('claude', CLAUDE_CONFIG_PATH);
    const antigravityServers = await getMcpServers('antigravity', ANTIGRAVITY_CONFIG_PATH);

    assert.deepStrictEqual(
      claudeServers['@yama662607/obsidian-companion-mcp']?.recipe?.env,
      recipeWithEnv.env
    );
    assert.deepStrictEqual(
      antigravityServers['@yama662607/obsidian-companion-mcp']?.recipe?.env,
      recipeWithEnv.env
    );
  });

  it('round-trips serverUrl for Antigravity HTTP configs', async () => {
    const httpRecipe: McpRecipe = {
      transport: 'http',
      url: 'https://example.com/mcp',
    };

    await fs.writeFile(ANTIGRAVITY_CONFIG_PATH, JSON.stringify({ mcpServers: {} }, null, 2));
    await addMcpToConfig('antigravity', ANTIGRAVITY_CONFIG_PATH, 'http-server', httpRecipe);

    const servers = await getMcpServers('antigravity', ANTIGRAVITY_CONFIG_PATH);
    assert.strictEqual(servers['http-server']?.recipe?.url, 'https://example.com/mcp');
  });
});
