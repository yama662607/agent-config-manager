// Unit tests for type definitions and validation

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import types for compile-time validation
import type {
  TargetName,
  TransportType,
  ProjectDiscovery,
  NativeConfigPath,
  McpRecipe,
  McpCatalogEntry,
  CatalogFile,
  ClaudeMcpConfig,
  CodexConfig,
  GeminiSettings,
  McpServerStatus,
  McpWorkspaceStatus,
  ConfigReadResult,
} from '../../src/types.js';

describe('Type Definitions', () => {
  it('should have valid TargetName types', () => {
    const claude: TargetName = 'claude';
    const codex: TargetName = 'codex';
    const gemini: TargetName = 'gemini';

    assert.strictEqual(claude, 'claude');
    assert.strictEqual(codex, 'codex');
    assert.strictEqual(gemini, 'gemini');
  });

  it('should have valid TransportType types', () => {
    const stdio: TransportType = 'stdio';
    const http: TransportType = 'http';
    const sse: TransportType = 'sse';

    assert.strictEqual(stdio, 'stdio');
    assert.strictEqual(http, 'http');
    assert.strictEqual(sse, 'sse');
  });

  it('should accept valid McpRecipe structures', () => {
    const stdioRecipe: McpRecipe = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { NODE_ENV: 'production' },
    };

    const httpRecipe: McpRecipe = {
      transport: 'http',
      url: 'https://example.com/mcp',
    };

    assert.strictEqual(stdioRecipe.command, 'npx');
    assert.strictEqual(httpRecipe.url, 'https://example.com/mcp');
  });

  it('should accept valid McpCatalogEntry structures', () => {
    const entry: McpCatalogEntry = {
      id: '@modelcontextprotocol/server-github',
      displayName: 'GitHub',
      description: 'GitHub MCP server',
      recipe: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      addedAt: new Date().toISOString(),
      tags: ['github', 'mcp'],
    };

    assert.strictEqual(entry.id, '@modelcontextprotocol/server-github');
    assert.strictEqual(entry.displayName, 'GitHub');
    assert.ok(Array.isArray(entry.tags));
  });

  it('should accept valid CatalogFile structures', () => {
    const catalog: CatalogFile = {
      version: '1.0',
      $schema: './catalog-schema.json',
      mcps: {
        'test-mcp': {
          id: 'test-mcp',
          displayName: 'Test MCP',
          description: 'Test MCP server',
          recipe: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'test-mcp'],
          },
          addedAt: new Date().toISOString(),
        },
      },
    };

    assert.strictEqual(catalog.version, '1.0');
    assert.ok(catalog.mcps['test-mcp']);
  });

  it('should accept valid ProjectDiscovery structures', () => {
    const discovery: ProjectDiscovery = {
      root: '/path/to/project',
      targets: new Map([
        ['claude', { target: 'claude', path: '/path/.mcp.json', exists: true }],
        ['codex', { target: 'codex', path: '/path/.codex/config.toml', exists: true }],
      ]),
    };

    assert.strictEqual(discovery.root, '/path/to/project');
    assert.strictEqual(discovery.targets.size, 2);
  });

  it('should accept valid McpWorkspaceStatus structures', () => {
    const status: McpWorkspaceStatus = {
      projectRoot: '/path/to/project',
      servers: [
        {
          name: 'github',
          enabled: true,
          targets: ['claude', 'codex'],
          source: 'catalog',
        },
      ],
      totalCount: 1,
      enabledCount: 1,
    };

    assert.strictEqual(status.projectRoot, '/path/to/project');
    assert.strictEqual(status.totalCount, 1);
    assert.strictEqual(status.enabledCount, 1);
  });
});
