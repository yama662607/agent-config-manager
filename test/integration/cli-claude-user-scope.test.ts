import { describe, it } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';

import { isClaudeUserScope, AGENT_GLOBAL_MCP_CONFIG } from '../../src/agent-paths.js';
import { isClaudeCliAvailable, listUserScopeServers } from '../../src/claude-user-mcp.js';

describe('Claude user scope', () => {
  it('resolves the home MCP config to the state file, not ~/.mcp.json', () => {
    // ~/.mcp.json is a project file that happens to live in the home directory:
    // Claude reads it only when the home directory is the project root.
    assert.strictEqual(AGENT_GLOBAL_MCP_CONFIG.claude, path.join(os.homedir(), '.claude.json'));
    assert.notStrictEqual(AGENT_GLOBAL_MCP_CONFIG.claude, path.join(os.homedir(), '.mcp.json'));
  });

  it('recognises the state file so writes are delegated', () => {
    assert.strictEqual(isClaudeUserScope(path.join(os.homedir(), '.claude.json')), true);
    assert.strictEqual(isClaudeUserScope(path.join(os.homedir(), '.mcp.json')), false);
    assert.strictEqual(isClaudeUserScope('/tmp/project/.mcp.json'), false);
  });

  it('reads the state file directly, since only writing is unsafe', async () => {
    const servers = await listUserScopeServers();
    assert.strictEqual(typeof servers, 'object');
    for (const recipe of Object.values(servers)) {
      assert.ok(recipe.command || recipe.url, 'every server must have something to launch');
    }
  });

  it('reports whether the CLI it delegates to is present', async () => {
    assert.strictEqual(typeof (await isClaudeCliAvailable()), 'boolean');
  });
});

describe('Server names Claude will accept', () => {
  it('stores a scoped package under a simple name and recovers the id', async () => {
    // Claude rejects `@scope/name`, so the entry is stored as `name` and the
    // package id is recovered from the recipe when read back.
    const { sanitizeServerName, inferPackageIdFromRecipe } = await import('../../src/mcp-names.js');

    assert.strictEqual(sanitizeServerName('@modelcontextprotocol/server-github'), 'github');
    assert.strictEqual(sanitizeServerName('already-simple'), 'already-simple');

    assert.strictEqual(
      inferPackageIdFromRecipe('npx', ['-y', '@modelcontextprotocol/server-github']),
      '@modelcontextprotocol/server-github'
    );
    assert.strictEqual(inferPackageIdFromRecipe('node', ['server.js']), null);
  });
});
