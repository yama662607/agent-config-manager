/**
 * Unit tests for MCP TUI Screen
 *
 * Tests TUI rendering logic without requiring interactive terminal.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { McpTuiScreen } from '../../../src/tui/mcp-tui.js';
import {
  ConsoleCapture,
  createMockTuiState,
  createMockMcpStatus,
  assertTuiRendering,
  assertTableStructure,
  testTuiScreen,
  stripAnsi,
  getCleanOutput,
} from '../../helpers/tui-test-helper.js';

describe('McpTuiScreen', () => {
  describe('Screen Properties', () => {
    it('should have correct screen name', () => {
      const screen = new McpTuiScreen();
      assert.strictEqual(screen.name, 'mcp');
    });
  });

  describe('Header Rendering', () => {
    it('should render header with correct title', () => {
      const screen = new McpTuiScreen() as any; // Access private method for testing
      const capture = new ConsoleCapture();

      capture.start();
      screen.renderHeader();
      capture.stop();

      assertTuiRendering(capture, {
        title: '🔧 Project MCPs',
      });
    });

    it('should render header with borders', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      capture.start();
      screen.renderHeader();
      capture.stop();

      const output = capture.getOutputString();
      assert.ok(output.includes('╔'), 'Should have top-left corner');
      assert.ok(output.includes('╗'), 'Should have top-right corner');
      assert.ok(output.includes('╚'), 'Should have bottom-left corner');
      assert.ok(output.includes('╝'), 'Should have bottom-right corner');
    });
  });

  describe('Status Table Rendering', () => {
    it('should render empty state when no servers configured', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      const emptyStatus = {
        claude: {},
        codex: {},
        gemini: {},
      };

      capture.start();
      screen.renderStatusTable(emptyStatus, 'claude');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['No MCP servers configured', 'Add MCP to project'],
      });
    });

    it('should render status table with servers', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      const status = createMockMcpStatus({
        'github': true,
        'filesystem': false,
      });

      capture.start();
      screen.renderStatusTable(status, 'claude');
      capture.stop();

      // Check table structure
      assertTableStructure(capture, {
        headers: ['Server', 'Status', 'C', 'C', 'G'],
        rows: [
          ['github', '✅ On'],
          ['filesystem', '❌ Off'],
        ],
        hasBorder: true,
      });
    });

    it('should show correct status icons for enabled/disabled', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      const status = createMockMcpStatus({
        'enabled-server': true,
        'disabled-server': false,
      });

      capture.start();
      screen.renderStatusTable(status, 'claude');
      capture.stop();

      const output = capture.getOutputString();
      assert.ok(output.includes('✅ On'), 'Should show enabled status');
      assert.ok(output.includes('❌ Off'), 'Should show disabled status');
    });

    it('should show legend below table', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      const status = createMockMcpStatus({
        'test': true,
      });

      capture.start();
      screen.renderStatusTable(status, 'claude');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['Legend', 'C=Claude', 'C=Codex', 'G=Gemini', '✅=Enabled', '❌=Disabled'],
      });
    });

    it('should display status for all targets', () => {
      const screen = new McpTuiScreen() as any;
      const capture = new ConsoleCapture();

      const status: Record<string, Record<string, { enabled: boolean }>> = {
        claude: { 'server1': { enabled: true } },
        codex: { 'server1': { enabled: true }, 'server2': { enabled: false } },
        gemini: { 'server1': { enabled: false } },
      };

      capture.start();
      screen.renderStatusTable(status, 'claude');
      capture.stop();

      const cleanOutput = getCleanOutput(capture);
      assert.ok(cleanOutput.includes('server1'), 'Should show server1');
      assert.ok(cleanOutput.includes('server2'), 'Should show server2');
    });
  });

  describe('Config Path Resolution', () => {
    it('should return correct path for Claude target', () => {
      const screen = new McpTuiScreen() as any;
      const path = screen.getDefaultConfigPath('claude', '/project/root');

      assert.ok(path.includes('.mcp.json'));
      assert.ok(path.includes('/project/root'));
    });

    it('should return correct path for Codex target', () => {
      const screen = new McpTuiScreen() as any;
      const path = screen.getDefaultConfigPath('codex', '/project/root');

      assert.ok(path.includes('.codex'));
      assert.ok(path.includes('config.toml'));
    });

    it('should return correct path for Gemini target', () => {
      const screen = new McpTuiScreen() as any;
      const path = screen.getDefaultConfigPath('gemini', '/project/root');

      assert.ok(path.includes('.gemini'));
      assert.ok(path.includes('settings.json'));
    });
  });

  describe('State Management', () => {
    it('should handle action function', async () => {
      const screen = new McpTuiScreen();
      const state = createMockTuiState();

      const result = await screen.handleAction(state, { type: 'test' });
      assert.strictEqual(result, state);
    });
  });
});

describe('TUI Helper Functions', () => {
  describe('ConsoleCapture', () => {
    it('should capture console.log output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Test message');
      capture.stop();

      assert.ok(capture.contains('Test message'));
    });

    it('should capture multiple outputs', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('First message');
      console.log('Second message');
      capture.stop();

      assert.ok(capture.contains('First message'));
      assert.ok(capture.contains('Second message'));
      assert.strictEqual(capture.getOutputs().length, 2);
    });

    it('should clear outputs', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Before clear');
      capture.clear();
      console.log('After clear');
      capture.stop();

      assert.ok(!capture.contains('Before clear'));
      assert.ok(capture.contains('After clear'));
    });

    it('should match regex patterns', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Server: github, Status: enabled');
      capture.stop();

      assert.ok(capture.matches(/Server:\s+\w+/));
      assert.ok(capture.matches(/Status:\s+\w+/));
    });

    it('should get lines containing text', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Line 1: apple');
      console.log('Line 2: banana');
      console.log('Line 3: apple pie');
      capture.stop();

      const appleLines = capture.getLinesContaining('apple');
      assert.strictEqual(appleLines.length, 2);
      assert.ok(appleLines[0].includes('apple'));
      assert.ok(appleLines[1].includes('apple pie'));
    });
  });

  describe('Mock State Creation', () => {
    it('should create mock TUI state with defaults', () => {
      const state = createMockTuiState();

      assert.strictEqual(state.currentScreen, 'mcp');
      assert.strictEqual(state.target, 'claude');
      assert.strictEqual(state.selectedItem, null);
      assert.strictEqual(state.filter, '');
      assert.strictEqual(state.lastAction, null);
    });

    it('should create mock TUI state with overrides', () => {
      const state = createMockTuiState({
        currentScreen: 'skill',
        target: 'gemini',
        selectedItem: 'test-item',
      });

      assert.strictEqual(state.currentScreen, 'skill');
      assert.strictEqual(state.target, 'gemini');
      assert.strictEqual(state.selectedItem, 'test-item');
    });

    it('should create mock MCP status', () => {
      const status = createMockMcpStatus({
        'server1': true,
        'server2': false,
      });

      assert.strictEqual(status.claude['server1'].enabled, true);
      assert.strictEqual(status.claude['server2'].enabled, false);
    });
  });

  describe('ANSI Code Stripping', () => {
    it('should remove ANSI escape codes', () => {
      const input = '\u001b[31mRed text\u001b[0m Normal text';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Red text Normal text');
    });

    it('should handle multiple ANSI codes', () => {
      const input = '\u001b[1m\u001b[32m\u001b[44mBold green on blue\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Bold green on blue');
    });

    it('should handle empty strings', () => {
      assert.strictEqual(stripAnsi(''), '');
    });

    it('should handle strings without ANSI codes', () => {
      const input = 'Plain text with no codes';
      assert.strictEqual(stripAnsi(input), input);
    });
  });

  describe('Table Structure Assertions', () => {
    it('should assert table headers', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('│ Name   │ Status │');
      console.log('│ server1 │ on     │');
      capture.stop();

      assertTableStructure(capture, {
        headers: ['Name', 'Status'],
        rows: [['server1'], ['on']],
      });
    });

    it('should throw when headers missing', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('│ Wrong │ Headers │');
      capture.stop();

      assert.throws(
        () => {
          assertTableStructure(capture, {
            headers: ['Name', 'Status'],
            rows: [],
          });
        },
        /Expected header/
      );
    });
  });

  describe('Test Wrapper', () => {
    it('should automatically manage capture lifecycle', async () => {
      let captureRef: ConsoleCapture | null = null;

      await testTuiScreen(async (capture) => {
        captureRef = capture;
        console.log('Test output in wrapper');

        assert.ok(capture.contains('Test output in wrapper'));
      });

      // Capture should be stopped after test
      assert.ok(captureRef);
    });
  });
});
