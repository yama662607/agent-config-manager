// Unit tests for catalog operations

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Import catalog functions
import {
  getCatalogDir,
  getCatalogPath,
  initCatalog,
  loadCatalog,
  addMcp,
  removeMcp,
  getMcp,
  listMcps,
  normalizeMcpPackage,
} from '../../src/catalog.js';
import type { McpCatalogEntry } from '../../src/types.js';

// Use a temporary catalog directory for testing
const TEST_CATALOG_DIR = path.join(os.tmpdir(), '.acsync-test');
const TEST_CATALOG_FILE = path.join(TEST_CATALOG_DIR, 'catalog.json');

describe('Catalog Module', () => {
  // Mock the home directory for testing
  let originalHome: string | undefined;

  before(async () => {
    // Save original HOME and set test directory
    originalHome = process.env.HOME;
    process.env.HOME = TEST_CATALOG_DIR;

    // Ensure test directory is clean
    await fs.rm(TEST_CATALOG_DIR, { recursive: true, force: true });
  });

  after(async () => {
    // Clean up test directory
    await fs.rm(TEST_CATALOG_DIR, { recursive: true, force: true });

    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }
  });

  describe('Path Resolution', () => {
    it('should return correct catalog directory', () => {
      const catalogDir = getCatalogDir();
      assert.ok(catalogDir.includes('.acsync'));
    });

    it('should return correct catalog file path', () => {
      const catalogPath = getCatalogPath();
      assert.ok(catalogPath.endsWith('catalog.json'));
    });
  });

  describe('Catalog Initialization', () => {
    it('should initialize an empty catalog', async () => {
      await initCatalog();

      const catalogPath = getCatalogPath();
      const exists = await fs.access(catalogPath).then(() => true).catch(() => false);
      assert.ok(exists, 'Catalog file should exist after init');
    });

    it('should not overwrite existing catalog', async () => {
      await initCatalog();

      // Create a test entry
      const testEntry: McpCatalogEntry = {
        id: 'test-mcp',
        displayName: 'Test MCP',
        description: 'Test MCP server',
        recipe: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'test-mcp'],
        },
        addedAt: new Date().toISOString(),
      };
      await addMcp(testEntry);

      // Re-initialize should not clear the catalog
      await initCatalog();

      const catalog = await loadCatalog();
      assert.ok(catalog.mcps['test-mcp'], 'Existing entry should persist');
    });
  });

  describe('Catalog CRUD Operations', () => {
    it('should add a new MCP entry', async () => {
      const entry: McpCatalogEntry = {
        id: '@test/server-test',
        displayName: 'Test Server',
        description: 'A test MCP server',
        recipe: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@test/server-test'],
        },
        addedAt: new Date().toISOString(),
      };

      await addMcp(entry);

      const retrieved = await getMcp('@test/server-test');
      assert.ok(retrieved, 'Entry should be retrievable');
      assert.strictEqual(retrieved?.id, '@test/server-test');
      assert.strictEqual(retrieved?.displayName, 'Test Server');
    });

    it('should list all MCP entries', async () => {
      const entry1: McpCatalogEntry = {
        id: 'test-1',
        displayName: 'Test 1',
        description: 'First test',
        recipe: { transport: 'stdio', command: 'test', args: [] },
        addedAt: new Date().toISOString(),
      };

      const entry2: McpCatalogEntry = {
        id: 'test-2',
        displayName: 'Test 2',
        description: 'Second test',
        recipe: { transport: 'stdio', command: 'test', args: [] },
        addedAt: new Date().toISOString(),
      };

      await addMcp(entry1);
      await addMcp(entry2);

      const entries = await listMcps();
      assert.ok(entries.length >= 2, 'Should have at least 2 entries');
    });

    it('should remove an MCP entry', async () => {
      const entry: McpCatalogEntry = {
        id: 'test-remove',
        displayName: 'Test Remove',
        description: 'Test removal',
        recipe: { transport: 'stdio', command: 'test', args: [] },
        addedAt: new Date().toISOString(),
      };

      await addMcp(entry);

      const removed = await removeMcp('test-remove');
      assert.ok(removed, 'Should return true when removed');

      const retrieved = await getMcp('test-remove');
      assert.ok(!retrieved, 'Entry should not exist after removal');
    });

    it('should return false when removing non-existent entry', async () => {
      const removed = await removeMcp('non-existent');
      assert.ok(!removed, 'Should return false for non-existent entry');
    });

    it('should update an existing entry', async () => {
      const entry: McpCatalogEntry = {
        id: 'test-update',
        displayName: 'Original Name',
        description: 'Original description',
        recipe: { transport: 'stdio', command: 'test', args: [] },
        addedAt: new Date().toISOString(),
      };

      await addMcp(entry);

      const updated: McpCatalogEntry = {
        ...entry,
        displayName: 'Updated Name',
        description: 'Updated description',
      };

      await addMcp(updated);

      const retrieved = await getMcp('test-update');
      assert.strictEqual(retrieved?.displayName, 'Updated Name');
      assert.strictEqual(retrieved?.description, 'Updated description');
    });
  });

  describe('Package Normalization', () => {
    it('should normalize npm package to stdio recipe', () => {
      const entry = normalizeMcpPackage('@modelcontextprotocol/server-github');

      assert.strictEqual(entry.id, '@modelcontextprotocol/server-github');
      assert.strictEqual(entry.recipe.transport, 'stdio');
      assert.strictEqual(entry.recipe.command, 'npx');
      assert.deepEqual(entry.recipe.args, ['-y', '@modelcontextprotocol/server-github']);
    });

    it('should extract display name from package ID', () => {
      const entry1 = normalizeMcpPackage('@modelcontextprotocol/server-github');
      assert.strictEqual(entry1.displayName, 'Github');

      const entry2 = normalizeMcpPackage('@upstash/context7-mcp');
      assert.strictEqual(entry2.displayName, 'Context7');
    });

    it('should accept custom recipe override', () => {
      const entry = normalizeMcpPackage('custom-mcp', {
        displayName: 'Custom MCP',
        description: 'A custom MCP server',
        recipe: {
          transport: 'http',
          url: 'https://example.com/mcp',
        },
      });

      assert.strictEqual(entry.displayName, 'Custom MCP');
      assert.strictEqual(entry.recipe.transport, 'http');
      assert.strictEqual(entry.recipe.url, 'https://example.com/mcp');
    });

    it('should accept custom stdio recipe', () => {
      const entry = normalizeMcpPackage('python-mcp', {
        recipe: {
          transport: 'stdio',
          command: 'uv',
          args: ['run', 'python', 'server.py'],
          cwd: '/path/to/mcp',
        },
      });

      assert.strictEqual(entry.recipe.command, 'uv');
      assert.deepEqual(entry.recipe.args, ['run', 'python', 'server.py']);
      assert.strictEqual(entry.recipe.cwd, '/path/to/mcp');
    });

    it('should set transport to http when URL is provided', () => {
      const entry = normalizeMcpPackage('http-mcp', {
        recipe: {
          url: 'https://example.com/mcp',
        },
      });

      assert.strictEqual(entry.recipe.transport, 'http');
      assert.strictEqual(entry.recipe.url, 'https://example.com/mcp');
    });
  });
});
