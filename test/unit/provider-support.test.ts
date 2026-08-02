import { describe, it } from 'node:test';
import assert from 'node:assert';

import { unsupportedScopeWarning } from '../../src/provider-support.js';

describe('Scope support', () => {
  it('warns that the Antigravity CLI ignores project scope', () => {
    // Writing a file no provider reads looks like success and is not.
    const mcp = unsupportedScopeWarning('antigravity', 'mcp', false);
    assert.match(mcp!, /no project-scope MCP configuration/);
    assert.match(mcp!, /-H/);

    const skill = unsupportedScopeWarning('antigravity', 'skill', false);
    assert.match(skill!, /does not read project skills/);
  });

  it('stays quiet for the home scope, which every provider reads', () => {
    assert.strictEqual(unsupportedScopeWarning('antigravity', 'mcp', true), null);
    assert.strictEqual(unsupportedScopeWarning('antigravity', 'skill', true), null);
  });

  it('stays quiet for providers that do read project scope', () => {
    for (const target of ['claude', 'codex', 'grok'] as const) {
      assert.strictEqual(unsupportedScopeWarning(target, 'mcp', false), null, target);
      assert.strictEqual(unsupportedScopeWarning(target, 'skill', false), null, target);
    }
  });
});
