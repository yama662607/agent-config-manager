import { describe, it } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_GLOBAL_MCP_CONFIG,
  AGENT_GLOBAL_SKILLS_DIR,
  AGENT_PLUGIN_DIR,
  isHomeScope,
} from '../../src/agent-paths.js';
import { getSkillsDir } from '../../src/skill-adapters.js';
import { getSkillsPath } from '../../src/project-discovery.js';
import { parseTargetList, VALID_TARGETS } from '../../src/target-utils.js';

const home = os.homedir();

describe('Agent global paths', () => {
  it('covers every target', () => {
    for (const target of VALID_TARGETS) {
      assert.ok(AGENT_GLOBAL_SKILLS_DIR[target], `skills dir missing for ${target}`);
      assert.ok(AGENT_GLOBAL_MCP_CONFIG[target], `mcp config missing for ${target}`);
      assert.ok(AGENT_PLUGIN_DIR[target], `plugin dir missing for ${target}`);
    }
  });

  it('uses the documented Antigravity global root, not ~/.agents', () => {
    // `~/.gemini/config/` is Antigravity's global customization root; `.agents/`
    // is only the project-scoped one. Treating home as a project would write to
    // ~/.agents, where the CLI never looks.
    assert.strictEqual(
      AGENT_GLOBAL_SKILLS_DIR.antigravity,
      path.join(home, '.gemini', 'config', 'skills')
    );
    assert.strictEqual(
      AGENT_GLOBAL_MCP_CONFIG.antigravity,
      path.join(home, '.gemini', 'config', 'mcp_config.json')
    );
  });

  it('detects home scope', () => {
    assert.strictEqual(isHomeScope(home), true);
    assert.strictEqual(isHomeScope(path.join(home, 'project')), false);
    assert.strictEqual(isHomeScope('/tmp/project'), false);
  });

  it('resolves skill directories per scope', () => {
    // Project scope keeps the in-repo layout.
    assert.strictEqual(
      getSkillsDir('/tmp/project', 'antigravity'),
      path.join('/tmp/project', '.agents', 'skills')
    );
    // Home scope switches to the global root.
    assert.strictEqual(
      getSkillsDir(home, 'antigravity'),
      path.join(home, '.gemini', 'config', 'skills')
    );
    // Targets whose global root is the same shape are unaffected.
    assert.strictEqual(getSkillsDir(home, 'claude'), path.join(home, '.claude', 'skills'));
    assert.strictEqual(getSkillsDir(home, 'codex'), path.join(home, '.codex', 'skills'));
    assert.strictEqual(getSkillsDir(home, 'grok'), path.join(home, '.grok', 'skills'));
  });

  it('resolves getSkillsPath per scope too', () => {
    assert.strictEqual(
      getSkillsPath(home, 'antigravity'),
      path.join(home, '.gemini', 'config', 'skills')
    );
    assert.strictEqual(
      getSkillsPath('/tmp/project', 'antigravity'),
      path.join('/tmp/project', '.agents', 'skills')
    );
  });
});

describe('Target parsing', () => {
  it('resolves every alias', () => {
    assert.deepStrictEqual(parseTargetList('c,x,a,k'), ['claude', 'codex', 'antigravity', 'grok']);
    assert.deepStrictEqual(parseTargetList('agy'), ['antigravity']);
    assert.deepStrictEqual(parseTargetList('g'), ['antigravity']);
    assert.deepStrictEqual(parseTargetList('grok'), ['grok']);
  });

  it('expands all and tolerates spacing and case', () => {
    assert.deepStrictEqual(parseTargetList('all'), VALID_TARGETS);
    assert.deepStrictEqual(parseTargetList(' Claude , CODEX '), ['claude', 'codex']);
  });

  it('rejects unknown targets', () => {
    assert.throws(() => parseTargetList('gemini'), /Invalid target: 'gemini'/);
  });
});
