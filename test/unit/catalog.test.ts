// Unit tests for catalog operations

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import * as TOML from 'smol-toml';

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
const TEST_CATALOG_DIR = path.join(os.tmpdir(), '.acm-test');

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
      assert.ok(catalogDir.includes('.acm'));
    });

    it('should return correct catalog file path', () => {
      const catalogPath = getCatalogPath();
      assert.ok(catalogPath.endsWith('catalog.toml'));
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

    it('should seamlessly migrate old catalog.json to catalog.toml', async () => {
      const oldPath = path.join(TEST_CATALOG_DIR, '.acm', 'catalog.json');
      const newPath = path.join(TEST_CATALOG_DIR, '.acm', 'catalog.toml');

      // Clean up first
      await fs.rm(newPath, { force: true });

      // Write an old JSON catalog
      const oldCatalog = {
        version: '1.0',
        mcps: {
          'migrated-mcp': {
            id: 'migrated-mcp',
            displayName: 'Migrated MCP',
            recipe: { transport: 'stdio', command: 'node' }
          }
        },
        skills: {}
      };
      await fs.mkdir(path.dirname(oldPath), { recursive: true });
      await fs.writeFile(oldPath, JSON.stringify(oldCatalog, null, 2), 'utf8');

      // Load catalog (should trigger migration)
      const loaded = await loadCatalog();

      // Assertions
      assert.ok(loaded.mcps['migrated-mcp'], 'Migrated MCP should be present in loaded catalog');
      
      const oldExists = await fs.access(oldPath).then(() => true).catch(() => false);
      const newExists = await fs.access(newPath).then(() => true).catch(() => false);
      
      assert.strictEqual(oldExists, false, 'Old JSON catalog file should be deleted');
      assert.strictEqual(newExists, true, 'New TOML catalog file should exist');
    });

    it('should seamlessly migrate old catalog.yaml to catalog.toml', async () => {
      const oldPathYaml = path.join(TEST_CATALOG_DIR, '.acm', 'catalog.yaml');
      const newPath = path.join(TEST_CATALOG_DIR, '.acm', 'catalog.toml');

      // Clean up first
      await fs.rm(newPath, { force: true });

      // Write an old YAML catalog
      const oldCatalog = {
        version: '1.0',
        mcps: {
          'migrated-mcp-yaml': {
            id: 'migrated-mcp-yaml',
            displayName: 'Migrated MCP YAML',
            recipe: { transport: 'stdio', command: 'node' }
          }
        },
        skills: {}
      };
      await fs.mkdir(path.dirname(oldPathYaml), { recursive: true });
      await fs.writeFile(oldPathYaml, YAML.stringify(oldCatalog), 'utf8');

      // Load catalog (should trigger migration)
      const loaded = await loadCatalog();

      // Assertions
      assert.ok(loaded.mcps['migrated-mcp-yaml'], 'Migrated MCP YAML should be present in loaded catalog');
      
      const oldExists = await fs.access(oldPathYaml).then(() => true).catch(() => false);
      const newExists = await fs.access(newPath).then(() => true).catch(() => false);
      
      assert.strictEqual(oldExists, false, 'Old YAML catalog file should be deleted');
      assert.strictEqual(newExists, true, 'New TOML catalog file should exist');
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

  describe('Copy-Paste MCP Support', () => {
    it('should dynamically import raw Claude/Codex mcpServers pasted into catalog.toml', async () => {
      const catalogPath = getCatalogPath();

      // Write a catalog file containing raw mcpServers block
      const rawCatalog = {
        version: '1.0',
        mcps: {},
        skills: {},
        mcpServers: {
          'pasted-mcp': {
            command: 'node',
            args: ['-v'],
            env: { PASTED_KEY: 'pasted_val' }
          }
        }
      };

      await fs.mkdir(path.dirname(catalogPath), { recursive: true });
      await fs.writeFile(catalogPath, TOML.stringify(rawCatalog as any), 'utf8');

      // Load catalog (should trigger conversion and cleanup)
      const loaded = await loadCatalog();

      // Assertions
      assert.ok(loaded.mcps['pasted-mcp'], 'Pasted MCP should be normalized into mcps mapping');
      assert.strictEqual(loaded.mcps['pasted-mcp']?.recipe.command, 'node');
      assert.deepEqual(loaded.mcps['pasted-mcp']?.recipe.args, ['-v']);
      assert.deepEqual(loaded.mcps['pasted-mcp']?.recipe.env, { PASTED_KEY: 'pasted_val' });

      // Verify the atomic cleanup on catalog.toml
      const savedRaw = await fs.readFile(catalogPath, 'utf8');
      const savedObj = TOML.parse(savedRaw) as any;
      assert.strictEqual(savedObj.mcpServers, undefined, 'Raw mcpServers block should be cleaned up from catalog.toml');
    });
  });

  describe('Skill Drag-and-Drop Auto-Discovery', () => {
    it('should automatically sync, register, and unregister skill folders on the fly', async () => {
      const skillId = 'dragged-skill';
      const skillDir = path.join(getCatalogDir(), 'skills', skillId);
      const skillFilePath = path.join(skillDir, 'SKILL.md');

      // Clean up folders first
      await fs.rm(skillDir, { recursive: true, force: true });

      // Call loadCatalog (index should not contain dragged-skill)
      let loaded = await loadCatalog();
      assert.strictEqual(loaded.skills[skillId], undefined);

      // Write a SKILL.md file to drag-and-drop a skill folder manually
      const skillContent = `---
name: Dragged Skill
description: A manually dropped skill folder
license: MIT
---
# Instructions
Do cool things.
`;
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(skillFilePath, skillContent, 'utf8');

      // Load catalog (should trigger auto-discovery and synchronization)
      loaded = await loadCatalog();

      // Assertions
      assert.ok(loaded.skills[skillId], 'Skill should be auto-discovered');
      assert.strictEqual(loaded.skills[skillId]?.displayName, 'Dragged Skill');
      assert.strictEqual(loaded.skills[skillId]?.description, 'A manually dropped skill folder');
      assert.strictEqual(loaded.skills[skillId]?.license, 'MIT');

      // Deleting the skill folder manually
      await fs.rm(skillDir, { recursive: true, force: true });

      // Load catalog again (should trigger unregistration)
      loaded = await loadCatalog();

      // Assertions
      assert.strictEqual(loaded.skills[skillId], undefined, 'Skill should be automatically unregistered after directory deletion');
    });

    it('should support symbolic links in skill auto-discovery', async () => {
      const targetSkillId = 'linked-target';
      const symlinkSkillId = 'linked-symlink';
      
      const targetDir = path.join(os.tmpdir(), '.acm-linked-target');
      const symlinkDir = path.join(getCatalogDir(), 'skills', symlinkSkillId);
      
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rm(symlinkDir, { recursive: true, force: true });
      
      const skillContent = `---
name: Linked Skill
description: A skill behind a symlink
license: Apache-2.0
---
# Body
`;
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'SKILL.md'), skillContent, 'utf8');
      
      // Create symlink
      await fs.mkdir(path.join(getCatalogDir(), 'skills'), { recursive: true });
      await fs.symlink(targetDir, symlinkDir, 'dir');
      
      // Load catalog to discover
      const loaded = await loadCatalog();
      
      assert.ok(loaded.skills[symlinkSkillId], 'Symlinked skill should be auto-discovered');
      assert.strictEqual(loaded.skills[symlinkSkillId]?.displayName, 'Linked Skill');
      assert.strictEqual(loaded.skills[symlinkSkillId]?.license, 'Apache-2.0');
      
      // Cleanup
      await fs.rm(symlinkDir, { force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    });
  });

  describe('MCP Metadata Merging', () => {
    it('should merge copy-pasted raw MCP server configuration with existing metadata', async () => {
      const catalogPath = getCatalogPath();
      
      // Setup catalog with existing entry containing custom tags/displayName
      const catalog: any = {
        version: '1.0',
        mcps: {
          'merge-mcp': {
            id: 'merge-mcp',
            displayName: 'My Custom Display Name',
            description: 'My custom description',
            recipe: { transport: 'stdio', command: 'node', args: ['old'] },
            addedAt: '2026-01-01T00:00:00.000Z',
            tags: ['custom-tag']
          }
        },
        skills: {}
      };
      await fs.mkdir(path.dirname(catalogPath), { recursive: true });
      await fs.writeFile(catalogPath, TOML.stringify(catalog), 'utf8');

      // Now load it, but simulate having raw mcpServers block with same ID
      const withPasted: any = {
        ...catalog,
        mcpServers: {
          'merge-mcp': {
            command: 'node',
            args: ['new-args'],
            env: { SOME_VAR: 'val' }
          }
        }
      };
      await fs.writeFile(catalogPath, TOML.stringify(withPasted), 'utf8');

      const loaded = await loadCatalog();

      const entry = loaded.mcps['merge-mcp'];
      assert.ok(entry);
      // Recipe should be updated
      assert.strictEqual(entry.recipe.command, 'node');
      assert.deepEqual(entry.recipe.args, ['new-args']);
      assert.deepEqual(entry.recipe.env, { SOME_VAR: 'val' });
      // Metadata should be preserved
      assert.strictEqual(entry.displayName, 'My Custom Display Name');
      assert.strictEqual(entry.description, 'My custom description');
      assert.strictEqual(entry.addedAt, '2026-01-01T00:00:00.000Z');
      assert.deepEqual(entry.tags, ['custom-tag']);
    });
  });
});
