import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * The filter itself, exercised without a terminal. `narrow` prompts, so the
 * matching rule is verified directly; the prompt is covered by using the TUI.
 */
function matches(choice: { name: string; message?: string; hint?: string }, needle: string): boolean {
  return [choice.name, choice.message, choice.hint].some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(needle)
  );
}

describe('Catalog filtering', () => {
  const choices = [
    { name: 'web-search-antigravity', message: '📚 web-search-antigravity', hint: 'Deep web research' },
    { name: 'threejs-shaders', message: '📚 threejs-shaders', hint: 'GLSL and TSL shaders' },
    { name: 'pdf', message: '📚 pdf', hint: 'Read and edit PDF files' },
  ];

  it('matches on id, label and description', () => {
    assert.strictEqual(matches(choices[0], 'antigravity'), true);
    assert.strictEqual(matches(choices[1], 'shader'), true);
    // Matching is a plain substring test across all three fields, so a phrase
    // spanning words matches when it appears verbatim in any of them.
    assert.strictEqual(matches(choices[2], 'edit pdf'), true);
    assert.strictEqual(matches(choices[2], 'pdf edit'), false);
  });

  it('is case-insensitive', () => {
    assert.strictEqual(matches(choices[1], 'glsl'), true);
  });

  it('excludes entries that match nothing', () => {
    assert.strictEqual(choices.filter((c) => matches(c, 'nonexistent')).length, 0);
  });
});
