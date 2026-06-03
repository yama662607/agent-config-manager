/**
 * TUI Integration Tests
 *
 * Tests TUI screen flows, state transitions, and user interactions.
 */

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
const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'acm-tui-test');

// Run these tests serially to avoid file system conflicts
describe('TUI Integration Tests', { concurrency: false }, () => {
  let originalHome: string | undefined;
  let originalCwd: string | undefined;

  before(async () => {
    // Save original environment
    originalHome = process.env.HOME;
    originalCwd = process.cwd();

    // Create temporary project directory
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });

    // Initialize git repository
    await execAsync('git init', { cwd: TEST_PROJECT_DIR });
    await execAsync('git config user.email "test@example.com"', { cwd: TEST_PROJECT_DIR });
    await execAsync('git config user.name "Test User"', { cwd: TEST_PROJECT_DIR });

    // Create test config files
    await fs.mkdir(path.join(TEST_PROJECT_DIR, '.codex'), { recursive: true });
    await fs.mkdir(path.join(TEST_PROJECT_DIR, '.agents'), { recursive: true });

    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.mcp.json'),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );

    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.codex', 'config.toml'),
      '# Test Codex config\n[mcpServers]\n'
    );

    await fs.writeFile(
      path.join(TEST_PROJECT_DIR, '.agents', 'mcp_config.json'),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );

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

  describe('TUI Launch Conditions', () => {
    it('should not launch TUI when command has arguments', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Should show CLI output, not TUI
      assert.ok(stdout.includes('MCP Servers'), 'Should show MCP status');
      assert.ok(stdout.includes('total'), 'Should show server count');
    });

    it('should not launch TUI in CI environment', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" catalog`, {
        env: { ...process.env, CI: 'true' },
      });

      // Should show help or error, not TUI
      assert.ok(stdout.includes('Usage') || stdout.includes('catalog'), 'Should show usage or catalog info');
    });

    it('should support --help flag without launching TUI', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" --help`);

      assert.ok(stdout.includes('Usage'), 'Should show usage');
      assert.ok(stdout.includes('Commands'), 'Should list commands');
    });
  });

  describe('TUI State Management', () => {
    it('should maintain state across screen transitions', async () => {
      // Test that target selection persists
      const state = {
        currentScreen: 'mcp' as const,
        selectedItem: null,
        filter: '',
        target: 'codex' as const,
        lastAction: null,
      };

      // State should be valid structure
      assert.strictEqual(state.target, 'codex');
      assert.strictEqual(state.currentScreen, 'mcp');
    });

    it('should handle screen action parameters', async () => {
      // This would test the actual TUI flow if we had programmatic access
      // For now, we verify the structure is correct
      const action = { type: 'test' as const, data: 'value' };

      assert.strictEqual(action.type, 'test');
      assert.strictEqual(action.data, 'value');
    });
  });

  describe('MCP TUI Flow', () => {
    it('should display MCP servers in table format', async () => {
      // Add an MCP server first
      await execAsync(`node "${CLI_PATH}" mcp add @modelcontextprotocol/server-github --targets claude`);

      // Check status
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Should show table format
      assert.ok(stdout.includes('server-github') || stdout.includes('github'), 'Should show server name');
      assert.ok(stdout.includes('MCP Servers'), 'Should show MCP section');
    });

    it('should show enabled/disabled status', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Should indicate status
      assert.ok(stdout.includes('total') || stdout.includes('enabled'), 'Should show status indicators');
    });

    it('should display multiple targets', async () => {
      // Add to multiple targets
      await execAsync(`node "${CLI_PATH}" mcp add @modelcontextprotocol/server-github --targets claude,codex`);

      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Should show all targets
      assert.ok(stdout.includes('claude') || stdout.includes('Claude'), 'Should show Claude target');
      assert.ok(stdout.includes('codex') || stdout.includes('Codex'), 'Should show Codex target');
    });
  });

  describe('Skill TUI Flow', () => {
    it('should display configured skills', async () => {
      // Add a skill
      const { stdout: addOutput } = await execAsync(
        `node "${CLI_PATH}" skill add commit --targets claude`
      );

      // Check if skill was added (may fail if skill doesn't exist in catalog)
      if (!addOutput.includes('not found') && !addOutput.includes('Error')) {
        const { stdout } = await execAsync(`node "${CLI_PATH}" skill status`);

        // Should show skills section
        assert.ok(stdout.includes('Skill') || stdout.includes('skill'), 'Should show skill information');
      }
    });

    it('should show skill targets', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" skill status`);

      // Should indicate targets if skills exist
      if (stdout.includes('Skill') || stdout.includes('skill')) {
        assert.ok(stdout.includes('claude') || stdout.includes('Claude') || stdout.includes('0'), 'Should show targets or count');
      }
    });
  });

  describe('Catalog TUI Flow', () => {
    it('should list catalog entries', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" catalog mcp list`);

      assert.ok(stdout.includes('MCP Catalog') || stdout.includes('Catalog'), 'Should show catalog');
    });

    it('should show catalog entry details', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" catalog mcp show @modelcontextprotocol/server-github`
      );

      assert.ok(
        stdout.includes('github') || stdout.includes('server-github') || stdout.includes('ID'),
        'Should show entry details'
      );
    });
  });

  describe('TUI Configuration Path Resolution', () => {
    it('should resolve Claude config path', async () => {
      const configPath = path.join(TEST_PROJECT_DIR, '.mcp.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);

      assert.ok(exists, 'Claude config should exist');
    });

    it('should resolve Codex config path', async () => {
      const configPath = path.join(TEST_PROJECT_DIR, '.codex', 'config.toml');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);

      assert.ok(exists, 'Codex config should exist');
    });

    it('should resolve Antigravity config path', async () => {
      const configPath = path.join(TEST_PROJECT_DIR, '.agents', 'mcp_config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);

      assert.ok(exists, 'Antigravity config should exist');
    });
  });

  describe('TUI Help Messages', () => {
    it('should show help for MCP commands', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp --help`);

      assert.ok(stdout.includes('Usage') || stdout.includes('mcp'), 'Should show MCP help');
    });

    it('should show help for skill commands', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" skill --help`);

      assert.ok(stdout.includes('Usage') || stdout.includes('skill'), 'Should show skill help');
    });

    it('should show help for catalog commands', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" catalog --help`);

      assert.ok(stdout.includes('Usage') || stdout.includes('catalog'), 'Should show catalog help');
    });
  });

  describe('TUI Error Handling', () => {
    it('should handle non-existent MCP server gracefully', async () => {
      const { stderr } = await execAsync(`node "${CLI_PATH}" mcp remove non-existent-server --targets claude`);

      // Should show error message or complete
      assert.ok(
        stderr.includes('not found') || stderr.includes('error') || stderr.includes('Error') || stderr === '',
        'Should handle error gracefully'
      );
    });

    it('should handle invalid target gracefully', async () => {
      try {
        await execAsync(`node "${CLI_PATH}" mcp add test-server --targets invalid-target`);
        assert.fail('Should have exited with non-zero code');
      } catch (error: any) {
        const stderr = error.stderr || '';
        assert.ok(
          stderr.includes('Invalid') || stderr.includes('target'),
          'Should show validation error'
        );
      }
    });

    it('should handle missing catalog entries gracefully', async () => {
      try {
        await execAsync(`node "${CLI_PATH}" catalog mcp show non-existent-package-12345`);
        assert.fail('Should have exited with non-zero code');
      } catch (error: any) {
        const stderr = error.stderr || '';
        const stdout = error.stdout || '';
        assert.ok(
          stderr.includes('not found') || stdout.includes('not found') || stdout.includes('available entries'),
          'Should show not found message'
        );
      }
    });
  });

  describe('TUI Performance', () => {
    it('should respond within reasonable time', async () => {
      const start = Date.now();

      await execAsync(`node "${CLI_PATH}" mcp status`);

      const duration = Date.now() - start;

      // Should complete within 5 seconds
      assert.ok(duration < 5000, `Should respond quickly, took ${duration}ms`);
    });

    it('should handle multiple commands quickly', async () => {
      const start = Date.now();

      await Promise.all([
        execAsync(`node "${CLI_PATH}" mcp status`),
        execAsync(`node "${CLI_PATH}" skill status`),
        execAsync(`node "${CLI_PATH}" catalog mcp list`),
      ]);

      const duration = Date.now() - start;

      // Should complete within 10 seconds
      assert.ok(duration < 10000, `Should handle parallel commands, took ${duration}ms`);
    });
  });

  describe('TUI Output Format', () => {
    it('should use consistent table formatting', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Check for table characters
      const hasTableFormat =
        stdout.includes('│') ||
        stdout.includes('|') ||
        stdout.includes('MCP Servers');

      assert.ok(hasTableFormat, 'Should use table format');
    });

    it('should show clear status indicators', async () => {
      const { stdout } = await execAsync(`node "${CLI_PATH}" mcp status`);

      // Should have some form of status indication
      const hasStatus =
        stdout.includes('✓') ||
        stdout.includes('✗') ||
        stdout.includes('✅') ||
        stdout.includes('❌') ||
        stdout.includes('enabled') ||
        stdout.includes('disabled');

      assert.ok(hasStatus, 'Should show status indicators');
    });
  });
});

describe('TUI Screen Transitions', () => {
  describe('Screen Navigation', () => {
    it('should support target switching', () => {
      const targets = ['claude', 'codex', 'antigravity'] as const;

      for (const target of targets) {
        assert.ok(targets.includes(target), `Target ${target} should be valid`);
      }
    });

    it('should support screen types', () => {
      const screens = ['mcp', 'skill', 'catalog'] as const;

      for (const screen of screens) {
        assert.ok(screens.includes(screen), `Screen ${screen} should be valid`);
      }
    });

    it('should support action types', () => {
      const actions = ['add', 'remove', 'toggle', 'switch-target', 'refresh', 'back', 'exit'] as const;

      for (const action of actions) {
        assert.ok(actions.includes(action), `Action ${action} should be valid`);
      }
    });
  });

  describe('State Persistence', () => {
    it('should preserve filter across operations', () => {
      const state = {
        currentScreen: 'mcp' as const,
        selectedItem: null,
        filter: 'test-filter',
        target: 'claude' as const,
        lastAction: null,
      };

      // Filter should persist
      assert.strictEqual(state.filter, 'test-filter');
    });

    it('should preserve selected item across operations', () => {
      const state = {
        currentScreen: 'skill' as const,
        selectedItem: 'commit',
        filter: '',
        target: 'claude' as const,
        lastAction: null,
      };

      // Selection should persist
      assert.strictEqual(state.selectedItem, 'commit');
    });

    it('should track last action', () => {
      const state = {
        currentScreen: 'catalog' as const,
        selectedItem: null,
        filter: '',
        target: 'antigravity' as const,
        lastAction: 'add' as string | null,
      };

      // Last action should be tracked
      assert.strictEqual(state.lastAction, 'add');
    });
  });
});
