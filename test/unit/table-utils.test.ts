import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getStringWidth, padRightWide, truncateWide } from '../../src/table-utils.js';

describe('table-utils', () => {
  describe('getStringWidth', () => {
    it('should return correct width for ASCII strings', () => {
      assert.strictEqual(getStringWidth('hello'), 5);
      assert.strictEqual(getStringWidth('1234567890'), 10);
    });

    it('should return correct width for CJK strings', () => {
      assert.strictEqual(getStringWidth('こんにちは'), 10);
      assert.strictEqual(getStringWidth('世界'), 4);
    });

    it('should return correct width for mixed strings', () => {
      assert.strictEqual(getStringWidth('Hello 世界'), 10); // 5 + 1 + 4
    });

    it('should handle emoji', () => {
      // Basic emoji are usually 2 cells
      assert.strictEqual(getStringWidth('📦'), 2);
      assert.strictEqual(getStringWidth('🚀'), 2);
    });

    it('should handle ANSI escape codes by counting them as zero width', () => {
      // Red "hello"
      const redHello = '\u001b[31mhello\u001b[0m';
      assert.strictEqual(getStringWidth(redHello), 5);
    });
  });

  describe('padRightWide', () => {
    it('should pad ASCII strings correctly', () => {
      assert.strictEqual(padRightWide('abc', 5), 'abc  ');
    });

    it('should pad CJK strings correctly', () => {
      assert.strictEqual(padRightWide('あいう', 10), 'あいう    ');
      assert.strictEqual(getStringWidth(padRightWide('あいう', 10)), 10);
    });
  });

  describe('truncateWide', () => {
    it('should not truncate if string is within maxWidth', () => {
      assert.strictEqual(truncateWide('hello', 10), 'hello');
      assert.strictEqual(truncateWide('こんにちは', 10), 'こんにちは');
    });

    it('should truncate ASCII strings and add ellipsis', () => {
      // "hello world" (11) truncated to 8 -> "hello..." (8)
      assert.strictEqual(truncateWide('hello world', 8), 'hello...');
    });

    it('should truncate CJK strings correctly', () => {
      // "あいうえおかきくけこ" (20) truncated to 10
      // "あいう..." (6 + 3 = 9) or "あいうえ..." (8 + 3 = 11 - too long)
      // The current implementation adds "..." which is 3 cells.
      const truncated = truncateWide('あいうえおかきくけこ', 10);
      assert.ok(getStringWidth(truncated) <= 10);
      assert.ok(truncated.endsWith('...'));
    });

    it('should handle boundary cases where ellipsis barely fits', () => {
      // "あいう" (6) truncated to 5 -> "a..." (1+3=4) or "..." (3)?
      // Actually "あ" is 2. 2 + 3 = 5. So "あ..." should fit.
      assert.strictEqual(truncateWide('あいう', 5), 'あ...');
    });
  });
});
