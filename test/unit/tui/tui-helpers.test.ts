/**
 * Unit tests for TUI Test Helper
 *
 * Tests the helper functions used across TUI tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ConsoleCapture,
  createMockTuiState,
  createMockMcpStatus,
  createMockSkills,
  assertTuiRendering,
  assertTableStructure,
  testTuiScreen,
  stripAnsi,
  getCleanOutput,
} from '../../helpers/tui-test-helper.js';

describe('TUI Test Helper - ConsoleCapture', () => {
  describe('Lifecycle Management', () => {
    it('should start and stop capture cleanly', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Test during capture');
      capture.stop();

      assert.ok(capture.contains('Test during capture'));
    });

    it('should handle multiple start/stop cycles', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('First');
      capture.stop();

      // Start new capture cycle - outputs are cleared on start
      capture.start();
      console.log('Second');
      capture.stop();

      // After second cycle, only second output should be captured
      const outputs = capture.getOutputs();
      assert.ok(outputs.some(o => o.includes('Second')));
    });

    it('should restore original console functions', () => {
      const capture = new ConsoleCapture();
      const originalLog = console.log;

      capture.start();
      capture.stop();

      assert.strictEqual(console.log, originalLog, 'console.log should be restored');
    });
  });

  describe('Output Capture', () => {
    it('should capture console.log output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Hello, World!');
      capture.stop();

      // ConsoleCapture records the output
      const outputs = capture.getOutputs();
      assert.ok(outputs.some(o => o.includes('Hello, World!')));
    });

    it('should capture console.error output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.error('Error message');
      capture.stop();

      assert.ok(capture.contains('Error message'));
    });

    it('should capture multiple lines', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Line 1');
      console.log('Line 2');
      console.log('Line 3');
      capture.stop();

      assert.strictEqual(capture.getOutputs().length, 3);
    });

    it('should handle different data types', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('String');
      console.log(123);
      console.log({ key: 'value' });
      console.log(['array', 'items']);
      capture.stop();

      assert.ok(capture.contains('String'));
      assert.ok(capture.contains('123'));
      assert.ok(capture.contains('key'));
      assert.ok(capture.contains('array'));
    });

    it('should handle empty output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      // No output
      capture.stop();

      assert.strictEqual(capture.getOutputs().length, 0);
      assert.strictEqual(capture.getOutputString(), '');
    });
  });

  describe('Output Querying', () => {
    it('should get all outputs as array', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('First');
      console.log('Second');
      capture.stop();

      const outputs = capture.getOutputs();
      assert.strictEqual(outputs.length, 2);
      assert.strictEqual(outputs[0], 'First');
      assert.strictEqual(outputs[1], 'Second');
    });

    it('should get output as single string', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Line 1');
      console.log('Line 2');
      capture.stop();

      const output = capture.getOutputString();
      assert.ok(output.includes('Line 1'));
      assert.ok(output.includes('Line 2'));
    });

    it('should filter lines containing text', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('apple pie');
      console.log('banana bread');
      console.log('apple cake');
      console.log('cherry tart');
      capture.stop();

      const appleLines = capture.getLinesContaining('apple');
      assert.strictEqual(appleLines.length, 2);
      assert.ok(appleLines[0].includes('apple pie'));
      assert.ok(appleLines[1].includes('apple cake'));
    });

    it('should return empty array when no matches', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('apple');
      console.log('banana');
      capture.stop();

      const cherryLines = capture.getLinesContaining('cherry');
      assert.strictEqual(cherryLines.length, 0);
    });
  });

  describe('Text Matching', () => {
    it('should check if output contains text', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('The quick brown fox');
      capture.stop();

      assert.ok(capture.contains('quick'));
      assert.ok(capture.contains('fox'));
      assert.ok(!capture.contains('lazy'));
    });

    it('should match regex patterns', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Server: github, Status: enabled');
      console.log('Port: 8080');
      capture.stop();

      assert.ok(capture.matches(/Server:\s+\w+/));
      assert.ok(capture.matches(/Port:\s+\d+/));
      assert.ok(!capture.matches(/Version:\s+\d+/));
    });

    it('should match complex regex patterns', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Error: File not found at /path/to/file');
      capture.stop();

      assert.ok(capture.matches(/Error:\s+File\s+not\s+found\s+at\s+.+/));
    });
  });

  describe('Output Management', () => {
    it('should clear captured output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Before clear');
      capture.clear();
      console.log('After clear');
      capture.stop();

      assert.ok(!capture.contains('Before clear'));
      assert.ok(capture.contains('After clear'));
    });

    it('should allow clearing multiple times', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('First');
      capture.clear();
      console.log('Second');
      capture.clear();
      console.log('Third');
      capture.stop();

      assert.ok(!capture.contains('First'));
      assert.ok(!capture.contains('Second'));
      assert.ok(capture.contains('Third'));
    });
  });
});

describe('TUI Test Helper - Mock State Creation', () => {
  describe('createMockTuiState', () => {
    it('should create state with default values', () => {
      const state = createMockTuiState();

      assert.strictEqual(state.currentScreen, 'mcp');
      assert.strictEqual(state.target, 'claude');
      assert.strictEqual(state.selectedItem, null);
      assert.strictEqual(state.filter, '');
      assert.strictEqual(state.lastAction, null);
    });

    it('should override specific properties', () => {
      const state = createMockTuiState({
        currentScreen: 'skill',
        target: 'gemini',
      });

      assert.strictEqual(state.currentScreen, 'skill');
      assert.strictEqual(state.target, 'gemini');
      assert.strictEqual(state.selectedItem, null); // Default
    });

    it('should allow overriding all properties', () => {
      const state = createMockTuiState({
        currentScreen: 'catalog',
        selectedItem: 'test-item',
        filter: 'test',
        target: 'codex',
        lastAction: 'add',
      });

      assert.strictEqual(state.currentScreen, 'catalog');
      assert.strictEqual(state.selectedItem, 'test-item');
      assert.strictEqual(state.filter, 'test');
      assert.strictEqual(state.target, 'codex');
      assert.strictEqual(state.lastAction, 'add');
    });
  });

  describe('createMockMcpStatus', () => {
    it('should create empty status by default', () => {
      const status = createMockMcpStatus();

      assert.ok(status.claude);
      assert.ok(status.codex);
      assert.ok(status.gemini);
      assert.strictEqual(Object.keys(status.claude).length, 0);
    });

    it('should create status with servers', () => {
      const status = createMockMcpStatus({
        'server1': true,
        'server2': false,
      });

      assert.strictEqual(status.claude['server1'].enabled, true);
      assert.strictEqual(status.claude['server2'].enabled, false);
    });

    it('should not populate codex and gemini by default', () => {
      const status = createMockMcpStatus({
        'test': true,
      });

      assert.strictEqual(Object.keys(status.codex).length, 0);
      assert.strictEqual(Object.keys(status.gemini).length, 0);
    });
  });

  describe('createMockSkills', () => {
    it('should create mock skill array', () => {
      const skills = createMockSkills([
        { name: 'commit', targets: ['claude', 'codex'] },
        { name: 'review', targets: ['claude'] },
      ]);

      assert.strictEqual(skills.length, 2);
      assert.strictEqual(skills[0].name, 'commit');
      assert.strictEqual(skills[1].name, 'review');
    });

    it('should preserve target information', () => {
      const skills = createMockSkills([
        { name: 'test', targets: ['claude', 'codex', 'gemini'] },
      ]);

      assert.deepStrictEqual(skills[0].targets, ['claude', 'codex', 'gemini']);
    });
  });
});

describe('TUI Test Helper - Assertion Functions', () => {
  describe('assertTuiRendering', () => {
    it('should assert title presence', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('🔧 Project MCPs');
      capture.stop();

      assert.ok(() => {
        assertTuiRendering(capture, { title: 'Project MCPs' });
      });
    });

    it('should throw when title missing', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Wrong Title');
      capture.stop();

      assert.throws(
        () => {
          assertTuiRendering(capture, { title: 'Expected Title' });
        },
        /Expected title/
      );
    });

    it('should assert multiple items', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Add skill');
      console.log('Remove skill');
      console.log('Exit');
      capture.stop();

      assert.ok(() => {
        assertTuiRendering(capture, {
          items: ['Add skill', 'Remove skill', 'Exit'],
        });
      });
    });

    it('should assert regex patterns', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Server: github, Port: 8080');
      capture.stop();

      assert.ok(() => {
        assertTuiRendering(capture, {
          patterns: [/Server:\s+\w+/, /Port:\s+\d+/],
        });
      });
    });
  });

  describe('assertTableStructure', () => {
    it('should assert table headers', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('│ Name │ Status │ Type │');
      capture.stop();

      assert.ok(() => {
        assertTableStructure(capture, {
          headers: ['Name', 'Status', 'Type'],
          rows: [],
        });
      });
    });

    it('should assert table rows', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('│ server1 │ enabled │ stdio │');
      console.log('│ server2 │ disabled │ http │');
      capture.stop();

      assert.ok(() => {
        assertTableStructure(capture, {
          headers: [],
          rows: [
            ['server1', 'enabled'],
            ['server2', 'disabled'],
          ],
        });
      });
    });

    it('should check for table borders when required', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('┌─────────┬─────────┐');
      console.log('│ Name    │ Status  │');
      console.log('└─────────┴─────────┘');
      capture.stop();

      assert.ok(() => {
        assertTableStructure(capture, {
          headers: ['Name'],
          rows: [],
          hasBorder: true,
        });
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

    it('should throw when rows missing', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('│ Name │ Status │');
      capture.stop();

      assert.throws(
        () => {
          assertTableStructure(capture, {
            headers: ['Name', 'Status'],
            rows: [['server1', 'enabled']],
          });
        },
        /Expected row/
      );
    });

    it('should throw when borders required but missing', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Name Status');
      console.log('server1 enabled');
      capture.stop();

      assert.throws(
        () => {
          assertTableStructure(capture, {
            headers: ['Name'],
            rows: [],
            hasBorder: true,
          });
        },
        /Expected table borders/
      );
    });
  });
});

describe('TUI Test Helper - ANSI Code Handling', () => {
  describe('stripAnsi', () => {
    it('should remove color codes', () => {
      const input = '\u001b[31mRed text\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Red text');
    });

    it('should remove bold codes', () => {
      const input = '\u001b[1mBold text\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Bold text');
    });

    it('should remove underline codes', () => {
      const input = '\u001b[4mUnderlined text\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Underlined text');
    });

    it('should handle multiple ANSI codes', () => {
      const input = '\u001b[1m\u001b[32m\u001b[44mBold green on blue\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Bold green on blue');
    });

    it('should handle mixed ANSI and plain text', () => {
      const input = 'Plain \u001b[31mred\u001b[0m plain \u001b[32mgreen\u001b[0m plain';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Plain red plain green plain');
    });

    it('should handle empty string', () => {
      assert.strictEqual(stripAnsi(''), '');
    });

    it('should handle string without ANSI codes', () => {
      const input = 'Plain text without codes';
      assert.strictEqual(stripAnsi(input), input);
    });

    it('should handle ANSI codes at end only', () => {
      const input = 'Text\u001b[0m';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Text');
    });

    it('should handle ANSI codes at start only', () => {
      const input = '\u001b[31mText';
      const cleaned = stripAnsi(input);

      assert.strictEqual(cleaned, 'Text');
    });
  });

  describe('getCleanOutput', () => {
    it('should return cleaned output from capture', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('\u001b[31mColored text\u001b[0m');
      capture.stop();

      const cleaned = getCleanOutput(capture);
      assert.strictEqual(cleaned, 'Colored text');
    });

    it('should handle multiple lines with ANSI codes', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('\u001b[1mBold\u001b[0m');
      console.log('\u001b[32mGreen\u001b[0m');
      console.log('Plain');
      capture.stop();

      const cleaned = getCleanOutput(capture);
      assert.ok(cleaned.includes('Bold'));
      assert.ok(cleaned.includes('Green'));
      assert.ok(cleaned.includes('Plain'));
    });

    it('should preserve newlines in cleaned output', () => {
      const capture = new ConsoleCapture();

      capture.start();
      console.log('Line 1');
      console.log('Line 2');
      capture.stop();

      const cleaned = getCleanOutput(capture);
      assert.ok(cleaned.includes('Line 1'));
      assert.ok(cleaned.includes('Line 2'));
    });
  });
});

describe('TUI Test Helper - Test Wrapper', () => {
  describe('testTuiScreen', () => {
    it('should automatically manage capture lifecycle', async () => {
      let insideTest = false;
      let captureProvided: ConsoleCapture | null = null;

      await testTuiScreen(async (capture) => {
        insideTest = true;
        captureProvided = capture;
        console.log('Test output');
      });

      assert.ok(insideTest, 'Test function should be executed');
      assert.ok(captureProvided, 'Capture should be provided');
      assert.ok(captureProvided!.contains('Test output'));
    });

    it('should handle synchronous test functions', async () => {
      await testTuiScreen((capture) => {
        console.log('Sync test');
        assert.ok(capture.contains('Sync test'));
      });
    });

    it('should handle errors in test functions', async () => {
      await assert.rejects(
        async () => {
          await testTuiScreen(() => {
            throw new Error('Test error');
          });
        },
        /Test error/
      );
    });
  });
});
