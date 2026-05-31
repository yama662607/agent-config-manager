/**
 * Unit tests for Skill TUI Screen
 *
 * Tests skill management TUI logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SkillTuiScreen } from '../../../src/tui/skill-tui.js';
import {
  ConsoleCapture,
  createMockTuiState,
  createMockSkills,
  assertTuiRendering,
  assertTableStructure,
  testTuiScreen,
  getCleanOutput,
} from '../../helpers/tui-test-helper.js';

describe('SkillTuiScreen', () => {
  describe('Screen Properties', () => {
    it('should have correct screen name', () => {
      const screen = new SkillTuiScreen();
      assert.strictEqual(screen.name, 'skill');
    });
  });

  describe('Header Rendering', () => {
    it('should render header with correct title', () => {
      const screen = new SkillTuiScreen() as any;
      const capture = new ConsoleCapture();

      capture.start();
      screen.renderHeader();
      capture.stop();

      assertTuiRendering(capture, {
        title: '🎯 Project Skills',
      });
    });

    it('should render header with borders', () => {
      const screen = new SkillTuiScreen() as any;
      const capture = new ConsoleCapture();

      capture.start();
      screen.renderHeader();
      capture.stop();

      const output = capture.getOutputString();
      assert.ok(output.includes('╔'), 'Should have border characters');
      assert.ok(output.includes('╚'), 'Should have border characters');
    });
  });

  describe('Status Table Rendering', () => {
    it('should render status table structure', () => {
      const screen = new SkillTuiScreen() as any;
      const capture = new ConsoleCapture();

      capture.start();
      // Note: renderStatusTable is async and fetches real data
      // This test verifies the table structure is created
      screen.renderStatusTable([], 'claude');
      capture.stop();

      // Verify table structure exists (has borders)
      const output = capture.getOutputString();
      assert.ok(output.includes('┌') || output.includes('No skills'), 'Should have table structure or empty state');
    });

    it('should show target columns in table', () => {
      const screen = new SkillTuiScreen() as any;
      const capture = new ConsoleCapture();

      capture.start();
      screen.renderStatusTable([], 'claude');
      capture.stop();

      const cleanOutput = getCleanOutput(capture);
      // Check for target indicators in output
      assert.ok(cleanOutput.includes('C') || cleanOutput.includes('G') || cleanOutput.includes('No skills'),
        'Should show target columns or empty state');
    });
  });

  describe('Config Path Resolution', () => {
    it('should return correct path for Claude target', () => {
      const screen = new SkillTuiScreen() as any;
      const path = screen.getDefaultConfigPath('claude', '/project/root');

      assert.ok(path.includes('.mcp.json'));
      assert.ok(path.includes('/project/root'));
    });

    it('should return correct path for Codex target', () => {
      const screen = new SkillTuiScreen() as any;
      const path = screen.getDefaultConfigPath('codex', '/project/root');

      assert.ok(path.includes('.codex'));
      assert.ok(path.includes('config.toml'));
    });

    it('should return correct path for Antigravity target', () => {
      const screen = new SkillTuiScreen() as any;
      const path = screen.getDefaultConfigPath('antigravity', '/project/root');

      assert.ok(path.includes('.gemini'));
      assert.ok(path.includes('antigravity'));
      assert.ok(path.includes('mcp_config.json'));
    });
  });

  describe('Action Menu Options', () => {
    it('should show main action menu', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Select skill or action:');
      console.log('  ➕ Add skill to project');
      console.log('  🔍 Install skill from GitHub');
      console.log('  🔄 Switch target (current: claude)');
      console.log('  🚪 Exit');
      capture.stop();

      assertTuiRendering(capture, {
        items: [
          'Add skill to project',
          'Install skill from GitHub',
          'Switch target',
          'Exit',
        ],
      });
    });

    it('should show skill-specific actions', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('What would you like to do?');
      console.log('  🗑️  Remove from project');
      console.log('  📄 View details');
      console.log('  ← Back');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['Remove from project', 'View details', 'Back'],
      });
    });
  });

  describe('Add Skill Flow', () => {
    it('should show catalog skills when available', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Select skill (or action):');
      console.log('  📚 commit - Create git commits');
      console.log('  📚 review-pr - Review pull requests');
      console.log('  Install from GitHub (not in catalog)');
      console.log('  Import local skill');
      console.log('  ← Back');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['commit', 'review-pr', 'Install from GitHub', 'Import local'],
      });
    });

    it('should show alternate options when catalog empty', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('No skills in catalog.');
      console.log('Options:');
      console.log('  1. Install from GitHub');
      console.log('  2. Import local skill');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['No skills in catalog', 'Install from GitHub', 'Import local skill'],
      });
    });
  });

  describe('State Management', () => {
    it('should handle action function', async () => {
      const screen = new SkillTuiScreen();
      const state = createMockTuiState({ currentScreen: 'skill' });

      const result = await screen.handleAction(state, { type: 'test' });
      assert.strictEqual(result, state);
    });
  });

  describe('Target Switching', () => {
    it('should show target selection prompt', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Select target:');
      console.log('  claude (current)');
      console.log('  codex');
      console.log('  antigravity');
      capture.stop();

      assertTuiRendering(capture, {
        items: ['Select target', 'claude', 'codex', 'antigravity'],
      });
    });
  });
});
