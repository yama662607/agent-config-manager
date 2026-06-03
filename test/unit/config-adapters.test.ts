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

    const servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.ok(servers['@modelcontextprotocol/server-github']);
  });

  it('can disable and remove a Codex MCP entry by package id', async () => {
    await fs.writeFile(CODEX_CONFIG_PATH, '# test config\n');
    await addMcpToConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github', GITHUB_RECIPE);

    await disableMcpInConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github');

    let servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.strictEqual(servers['@modelcontextprotocol/server-github']?.enabled, false);

    await removeMcpFromConfig('codex', CODEX_CONFIG_PATH, '@modelcontextprotocol/server-github');

    servers = await getMcpServers('codex', CODEX_CONFIG_PATH);
    assert.deepStrictEqual(servers, {});

    const result = await readNativeConfig('codex', CODEX_CONFIG_PATH);
    assert.deepStrictEqual(result.config, { mcp_servers: {} });
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
