/**
 * TUI Test Helper
 *
 * Helper functions for testing TUI screens without requiring interactive terminal.
 */

import type { TuiState } from '../../src/tui/tui-base.js';
import type { TargetName } from '../../src/types.js';
import { Writable } from 'node:stream';

/**
 * Console output capturer for testing TUI rendering
 */
export class ConsoleCapture {
  private outputs: string[] = [];
  private originalLog?: typeof console.log;
  private originalError?: typeof console.error;
  private originalWrite?: typeof process.stdout.write;
  private depth = 0;

  /**
   * Start capturing console output
   */
  start(): void {
    this.outputs = [];
    this.depth = 0;
    this.originalLog = console.log;
    this.originalError = console.error;
    this.originalWrite = process.stdout.write;

    const self = this;

    const capture = (args: unknown[]): void => {
      self.outputs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    };

    console.log = (...args: unknown[]) => {
      self.depth++;
      if (self.depth === 1) {
        capture(args);
      }
      if (self.originalLog && self.depth <= 2) {
        self.originalLog(...args);
      }
      self.depth--;
    };

    console.error = (...args: unknown[]) => {
      self.depth++;
      if (self.depth === 1) {
        capture(args);
      }
      if (self.originalError && self.depth <= 2) {
        self.originalError(...args);
      }
      self.depth--;
    };

    // Note: We don't mock process.stdout.write to avoid breaking terminal escape sequences
    // Tests should rely on console.log captures for assertions
  }

  /**
   * Stop capturing and restore original functions
   */
  stop(): void {
    if (this.originalLog) console.log = this.originalLog;
    if (this.originalError) console.error = this.originalError;
    if (this.originalWrite) process.stdout.write = this.originalWrite;
  }

  /**
   * Get all captured output
   */
  getOutputs(): string[] {
    return [...this.outputs];
  }

  /**
   * Get output as single string
   */
  getOutputString(): string {
    return this.outputs.join('\n');
  }

  /**
   * Clear captured output
   */
  clear(): void {
    this.outputs = [];
  }

  /**
   * Check if output contains expected text
   */
  contains(text: string): boolean {
    return this.outputs.some(output => output.includes(text));
  }

  /**
   * Check if output matches regex
   */
  matches(pattern: RegExp): boolean {
    return this.outputs.some(output => pattern.test(output));
  }

  /**
   * Get lines containing specific text
   */
  getLinesContaining(text: string): string[] {
    return this.outputs.filter(output => output.includes(text));
  }
}

/**
 * Create a mock TUI state for testing
 */
export function createMockTuiState(overrides?: Partial<TuiState>): TuiState {
  return {
    currentScreen: 'mcp',
    selectedItem: null,
    filter: '',
    target: 'claude',
    lastAction: null,
    ...overrides,
  };
}

/**
 * Create mock MCP server status data
 */
export function createMockMcpStatus(
  servers: Record<string, boolean> = {}
): Record<TargetName, Record<string, { enabled: boolean }>> {
  return {
    claude: Object.fromEntries(
      Object.entries(servers).map(([name, enabled]) => [name, { enabled }])
    ),
    codex: {},
    antigravity: {},
  };
}

/**
 * Create mock skill data
 */
export interface MockSkill {
  name: string;
  targets: TargetName[];
}

export function createMockSkills(skills: MockSkill[]): MockSkill[] {
  return skills;
}

/**
 * Assert that TUI rendering contains expected elements
 */
export function assertTuiRendering(
  capture: ConsoleCapture,
  expected: {
    title?: string;
    items?: string[];
    patterns?: RegExp[];
  }
): void {
  if (expected.title) {
    const found = capture.contains(expected.title);
    if (!found) {
      throw new Error(`Expected title "${expected.title}" not found in output:\n${capture.getOutputString()}`);
    }
  }

  if (expected.items) {
    for (const item of expected.items) {
      if (!capture.contains(item)) {
        throw new Error(`Expected item "${item}" not found in output:\n${capture.getOutputString()}`);
      }
    }
  }

  if (expected.patterns) {
    for (const pattern of expected.patterns) {
      if (!capture.matches(pattern)) {
        throw new Error(`Expected pattern ${pattern} not found in output:\n${capture.getOutputString()}`);
      }
    }
  }
}

/**
 * Test wrapper for TUI screen tests
 */
export async function testTuiScreen(
  testFn: (capture: ConsoleCapture) => Promise<void> | void
): Promise<void> {
  const capture = new ConsoleCapture();

  try {
    capture.start();
    await testFn(capture);
  } finally {
    capture.stop();
  }
}

/**
 * Mock enquirer Select prompt for testing
 *
 * Note: This is a simplified mock. For complex prompt testing,
 * consider using dependency injection to pass prompt responses.
 */
export function mockSelectPrompt(response: string | (() => string)): void {
  // This would be implemented by creating a test version of TUI screens
  // that accept injected prompt responses
  // For now, TUI tests should focus on rendering logic, not interaction
}

/**
 * Assert table rendering structure
 */
export function assertTableStructure(
  capture: ConsoleCapture,
  expected: {
    headers: string[];
    rows: string[][];
    hasBorder?: boolean;
  }
): void {
  const output = capture.getOutputString();

  // Check headers
  for (const header of expected.headers) {
    if (!output.includes(header)) {
      throw new Error(`Expected header "${header}" not found`);
    }
  }

  // Check rows (at least one cell from each row should be present)
  for (const row of expected.rows) {
    const hasRow = row.some(cell => output.includes(cell));
    if (!hasRow) {
      throw new Error(`Expected row ${row.join(', ')} not found`);
    }
  }

  // Check for table borders if expected
  if (expected.hasBorder) {
    if (!output.includes('─') && !output.includes('│') && !output.includes('┌')) {
      throw new Error('Expected table borders not found');
    }
  }
}

/**
 * Strip ANSI escape codes from string for clean assertions
 */
export function stripAnsi(text: string): string {
  // Remove ANSI escape sequences
  return text.replace(
    /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

/**
 * Get clean text output without ANSI codes
 */
export function getCleanOutput(capture: ConsoleCapture): string {
  return stripAnsi(capture.getOutputString());
}
