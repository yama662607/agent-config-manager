/**
 * Table formatting utilities for Unicode/multibyte character support.
 */

/**
 * Remove ANSI escape codes from a string.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
  ].join('|');
  const ansiRegex = new RegExp(pattern, 'g');
  return str.replace(ansiRegex, '');
}

/**
 * Get the display width of a single character.
 */
function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // Zero-width characters (Variation Selectors, Zero-Width Space/Joiner, etc.)
  if (
    (code >= 0xFE00 && code <= 0xFE0F) || // Variation Selectors
    (code >= 0x200B && code <= 0x200D) || // Zero-Width Space, Non-Joiner, Joiner
    code === 0x2060 ||                    // Word Joiner
    code === 0xFEFF                       // Zero Width No-Break Space
  ) {
    return 0;
  }

  // Full-width characters (CJK Unified Ideographs, Hangul, Katakana, Hiragana, etc.)
  if (
    (code >= 0x1100 && code <= 0x115F) || // Hangul Jamo
    (code >= 0x2E80 && code <= 0xA4CF) || // CJK
    (code >= 0xA960 && code <= 0xA97C) || // Hangul Jamo Extended-A
    (code >= 0xAC00 && code <= 0xD7A3) || // Hangul Syllables
    (code >= 0xF900 && code <= 0xFAFF) || // CJK Compatibility Ideographs
    (code >= 0xFE10 && code <= 0xFE19) || // Vertical Forms
    (code >= 0xFE30 && code <= 0xFE6F) || // CJK Compatibility Forms
    (code >= 0xFF00 && code <= 0xFF60) || // Fullwidth Forms
    (code >= 0xFFE0 && code <= 0xFFE6) || // Fullwidth Forms
    (code >= 0x2600 && code <= 0x27BF) || // Miscellaneous Symbols & Dingbats (✅, ❌, ➕, ✏️, etc.)
    (code >= 0x1F000 && code <= 0x1F9FF) || // Emoji & Symbols
    (code >= 0x20000 && code <= 0x2FFFD) || // CJK Extension
    (code >= 0x30000 && code <= 0x3FFFD) || // CJK Extension
    (code >= 0x1F300 && code <= 0x1F9FF)   // Emoji
  ) {
    return 2;
  }
  return 1;
}

/**
 * Get the display width of a string.
 * - Full-width characters (CJK, emoji) count as 2
 * - Half-width characters (ASCII, Latin) count as 1
 * - ANSI escape codes count as 0
 */
export function getStringWidth(str: string): number {
  const cleanStr = stripAnsi(str);
  let width = 0;
  for (const char of cleanStr) {
    width += getCharWidth(char);
  }
  return width;
}

/**
 * Pad a string to a specified width, considering multibyte characters.
 */
export function padRightWide(str: string, width: number, padChar = ' '): string {
  const strWidth = getStringWidth(str);
  const paddingNeeded = Math.max(0, width - strWidth);
  return str + padChar.repeat(paddingNeeded);
}

/**
 * Center a string within a specified width, considering multibyte characters.
 */
export function centerWide(str: string, width: number, padChar = ' '): string {
  const strWidth = getStringWidth(str);
  if (strWidth >= width) {
    return str;
  }
  const leftPadding = Math.floor((width - strWidth) / 2);
  const rightPadding = width - strWidth - leftPadding;
  return padChar.repeat(leftPadding) + str + padChar.repeat(rightPadding);
}

/**
 * Truncate a string to fit within a specified width, considering multibyte characters.
 * Adds "..." if truncated.
 */
export function truncateWide(str: string, maxWidth: number): string {
  const cleanStr = stripAnsi(str);
  const totalWidth = getStringWidth(cleanStr);

  if (totalWidth <= maxWidth) {
    return str;
  }

  const ellipsis = '...';
  const ellipsisWidth = 3;
  
  if (maxWidth <= ellipsisWidth) {
    return ellipsis.slice(0, maxWidth);
  }

  let currentWidth = 0;
  let result = '';

  for (const char of cleanStr) {
    const charWidth = getCharWidth(char);
    if (currentWidth + charWidth + ellipsisWidth > maxWidth) {
      break;
    }
    result += char;
    currentWidth += charWidth;
  }

  return result + ellipsis;
}

/**
 * Truncate a string to a specified character length (legacy, for backward compatibility).
 * @deprecated Use truncateWide for better Unicode support.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen - 1) + '…';
}
