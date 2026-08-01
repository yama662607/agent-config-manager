import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  checkUpstream,
  classifySource,
  parseGitHubSource,
} from '../../src/skill-provenance.js';

describe('GitHub source parsing', () => {
  it('parses a tree URL', () => {
    const source = parseGitHubSource('https://github.com/anthropics/skills/tree/main/skills/pdf');
    assert.deepStrictEqual(source, {
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      path: 'skills/pdf',
    });
  });

  it('tracks a SKILL.md blob by its directory', () => {
    // The unit that gets updated is the skill directory, not the one file.
    const source = parseGitHubSource(
      'https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md'
    );
    assert.strictEqual(source?.path, 'skills/pdf');
  });

  it('accepts a repository root', () => {
    const source = parseGitHubSource('https://github.com/owner/repo');
    assert.deepStrictEqual(source, { owner: 'owner', repo: 'repo', ref: 'HEAD', path: '' });
  });

  it('handles a tag or SHA as the ref', () => {
    assert.strictEqual(
      parseGitHubSource('https://github.com/o/r/tree/v1.2.0/skills/x')?.ref,
      'v1.2.0'
    );
  });

  it('rejects non-GitHub and malformed URLs', () => {
    assert.strictEqual(parseGitHubSource('https://gitlab.com/o/r/tree/main/x'), null);
    assert.strictEqual(parseGitHubSource('not a url'), null);
    assert.strictEqual(parseGitHubSource('https://github.com/only-owner'), null);
    assert.strictEqual(parseGitHubSource('https://github.com/o/r/raw/main/x'), null);
  });
});

describe('Source classification', () => {
  it('labels each origin', () => {
    assert.strictEqual(classifySource('https://github.com/o/r/tree/main/s'), 'github');
    assert.strictEqual(classifySource('/Users/username/Code/skill'), 'local');
    assert.strictEqual(classifySource('https://example.com/skill.zip'), 'unknown');
    assert.strictEqual(classifySource(undefined), undefined);
  });
});

describe('Upstream comparison', () => {
  // These cases resolve without any network access.

  it('reports a forked entry without checking upstream', async () => {
    const status = await checkUpstream('forked-skill', {
      forked: true,
      sourceUrl: 'https://github.com/o/r/tree/main/s',
      sourceRef: 'abc',
    });
    assert.strictEqual(status.state, 'forked');
  });

  it('reports unknown when nothing was recorded', async () => {
    const status = await checkUpstream('bare-skill', {});
    assert.strictEqual(status.state, 'unknown');
    assert.match(status.detail!, /no source recorded/);
  });

  it('reports unknown for an origin it cannot query', async () => {
    const status = await checkUpstream('vendored-skill', {
      sourceUrl: 'https://example.com/skills/thing',
    });
    assert.strictEqual(status.state, 'unknown');
    assert.match(status.detail!, /only GitHub/);
  });

  it('does not claim up-to-date when the import revision is missing', async () => {
    // Without the revision this copy came from, "behind" and "locally edited"
    // are indistinguishable, so neither may be asserted.
    const status = await checkUpstream('half-recorded', {
      sourceUrl: 'https://github.com/o/r/tree/main/s',
    });
    assert.notStrictEqual(status.state, 'up-to-date');
    assert.notStrictEqual(status.state, 'behind');
  });
});
