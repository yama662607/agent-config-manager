// Integration tests for MCP CLI commands

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');

// Test project directory
const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'acsync-test-project');

describe('MCP CLI Integration Tests', () => {
  let originalHome: string | undefined;
  let originalCwd: string | undefined;

  before(async () => {
    // Save original environment
    originalHome = process.env.HOME;
    originalCwd = process.cwd();

    // Create temporary project directory
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });

    // Initialize git repository for project discovery
    await execAsync('git init', { cwd: TEST_PROJECT_DIR });
    await execAsync('git config user.email "test@example.com"', { cwd: TEST_PROJECT_DIR });
    await execAsync('git config user.name "Test User"', { cwd: TEST_PROJECT_DIR });

    // Create test config files
    await fs.mkdir(path.join(TEST_PROJECT_DIR, '.codex'), { recursive: true });
    await fs.mkdir(path.join(TEST_PROJECT_DIR, '.gemini', 'antigravity'), { recursive: true });

    // Claude .mcp.json
    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.mcp.json'),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );

    // Codex config.toml
    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.codex', 'config.toml'),
      '# Test Codex config\n'
    );

    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.gemini', 'antigravity', 'mcp_config.json'),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );

    // Change to test project directory
    process.chdir(TEST_PROJECT_DIR);
  });

  after(async () => {
    // Restore original directory
    if (originalCwd) {
      process.chdir(originalCwd);
    }

    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    // Clean up test directory
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
  });

  describe('Project Discovery', () => {
    it('should discover project from nested directory', async () => {
      const nestedDir = path.join(TEST_PROJECT_DIR, 'src', 'components');
      await fs.mkdir(nestedDir, { recursive: true });
      process.chdir(nestedDir);

      // Run acsync from nested directory using absolute path to CLI
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`, {
        cwd: nestedDir,
      });

      assert.ok(stdout.includes('Project:'), 'Should show project root');
      assert.ok(stdout.includes(TEST_PROJECT_DIR), 'Should detect correct project root');
    });
  });

  describe('MCP Status Command', () => {
    it('should show empty MCP status', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      assert.ok(stdout.includes('MCP Servers'), 'Should show MCP servers section');
      assert.ok(stdout.includes('0 total'), 'Should show 0 servers');
    });

    it('should support --verbose flag', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp --verbose`);

      assert.ok(stdout.includes('MCP Servers'), 'Should show MCP servers section');
    });
  });

  describe('MCP Add Command', () => {
    it('should add an MCP server to project', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout, stderr } = await execAsync(
        `node "${CLI_PATH}" mcp add @modelcontextprotocol/server-github --targets claude`
      );

      // Verify output
      assert.ok(
        stdout.includes('Added to claude') || stderr.includes('Added to claude'),
        'Should confirm addition to Claude'
      );

      // Verify the config was updated
      const mcpJson = await fs.readFile(
        path.join(TEST_PROJECT_DIR, '.mcp.json'),
        'utf8'
      );
      const config = JSON.parse(mcpJson);
      assert.ok(config.mcpServers, 'Should have mcpServers key');
    });

    it('should write a valid Codex MCP key for npm package servers', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout, stderr } = await execAsync(
        `node "${CLI_PATH}" mcp add @modelcontextprotocol/server-github --targets codex`
      );

      assert.ok(
        stdout.includes('Added to codex') || stderr.includes('Added to codex'),
        'Should confirm addition to Codex'
      );

      const codexToml = await fs.readFile(
        path.join(TEST_PROJECT_DIR, '.codex', 'config.toml'),
        'utf8'
      );

      assert.match(codexToml, /\[mcp_servers\.github\]/);
      assert.ok(!/\[mcp_servers\."@modelcontextprotocol\/server-github"\]/.test(codexToml));
    });

    it('should add custom env configuration across targets', async () => {
      process.chdir(TEST_PROJECT_DIR);

      await execAsync(
        `node "${CLI_PATH}" mcp add @yama662607/obsidian-companion-mcp --command npx --args '["-y","@yama662607/obsidian-companion-mcp"]' --env OBSIDIAN_VAULT_PATH=/vault/main --targets claude,codex,antigravity --no-register`
      );

      const claudeConfig = JSON.parse(await fs.readFile(path.join(TEST_PROJECT_DIR, '.mcp.json'), 'utf8'));
      const antigravityConfig = JSON.parse(await fs.readFile(path.join(TEST_PROJECT_DIR, '.gemini', 'antigravity', 'mcp_config.json'), 'utf8'));
      const codexToml = await fs.readFile(path.join(TEST_PROJECT_DIR, '.codex', 'config.toml'), 'utf8');

      assert.strictEqual(
        claudeConfig.mcpServers['@yama662607/obsidian-companion-mcp'].env.OBSIDIAN_VAULT_PATH,
        '/vault/main'
      );
      assert.strictEqual(
        antigravityConfig.mcpServers['@yama662607/obsidian-companion-mcp'].env.OBSIDIAN_VAULT_PATH,
        '/vault/main'
      );
      assert.match(codexToml, /\[mcp_servers\.obsidian_companion\.env\]/);
      assert.match(codexToml, /OBSIDIAN_VAULT_PATH = "\/vault\/main"/);
    });

    it('should edit environment variables for an existing MCP server', async () => {
      process.chdir(TEST_PROJECT_DIR);

      await execAsync(
        `node "${CLI_PATH}" mcp add @yama662607/obsidian-excalidraw-mcp --command npx --args '["-y","@yama662607/obsidian-excalidraw-mcp"]' --targets codex --no-register`
      );

      await execAsync(
        `node "${CLI_PATH}" mcp edit @yama662607/obsidian-excalidraw-mcp --command npx --args '["-y","@yama662607/obsidian-excalidraw-mcp"]' --env OBSIDIAN_VAULT_PATH=/vault/main --targets codex`
      );

      const codexToml = await fs.readFile(path.join(TEST_PROJECT_DIR, '.codex', 'config.toml'), 'utf8');
      assert.match(codexToml, /\[mcp_servers\.obsidian_excalidraw\.env\]/);
      assert.match(codexToml, /OBSIDIAN_VAULT_PATH = "\/vault\/main"/);
    });
  });

  describe('Catalog MCP Commands', () => {
    it('should list catalog entries', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" catalog mcp list`);

      assert.ok(stdout.includes('MCP Catalog'), 'Should show catalog header');
    });

    it('should show specific catalog entry', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" catalog mcp show @modelcontextprotocol/server-github`
      );

      assert.ok(
        stdout.includes('server-github') || stdout.includes('GitHub'),
        'Should show server details'
      );
    });
  });

  describe('Validate Command', () => {
    it('should validate project configuration', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout } = await execAsync(`node "${CLI_PATH}" validate`);

      assert.ok(stdout.includes('Validation passed') || stdout.includes('Checking'), 'Should show validation result');
    });
  });

  describe('Doctor Command', () => {
    it('should run diagnostics', async () => {
      process.chdir(TEST_PROJECT_DIR);

      const { stdout } = await execAsync(`node "${CLI_PATH}" doctor`);

      assert.ok(stdout.includes('Diagnostics') || stdout.includes('Project'), 'Should show diagnostic output');
      assert.ok(stdout.includes('Environment'), 'Should check environment');
    });
  });
});
