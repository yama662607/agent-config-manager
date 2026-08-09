import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * A skill is a directory, and `acm skill install <github-url>` used to fetch
 * only SKILL.md — the third place this project made that mistake, after the
 * plugin import dropped 3,533 skill files and 21 `.mcp.json` files.
 *
 * These tests stub `fetch`, so they neither reach the network nor depend on
 * GitHub's rate limit.
 */

const realFetch = globalThis.fetch;

/** Reply to a tree listing and to raw file requests, and record what was asked. */
function stubGitHub(tree: { path: string; type: string; size?: number }[] | null): string[] {
  const asked: string[] = [];

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    asked.push(url);

    if (url.includes('api.github.com')) {
      if (tree === null) return new Response('nope', { status: 403 });
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    return new Response(Buffer.from('file body'), { status: 200 });
  }) as typeof fetch;

  return asked;
}

const URL_UNDER_TEST = 'https://github.com/acme/repo/tree/main/skills/demo';

describe('Listing a skill directory on GitHub', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns the files under the skill, with paths relative to it', async () => {
    stubGitHub([
      { path: 'skills/demo/SKILL.md', type: 'blob', size: 10 },
      { path: 'skills/demo/references/api.md', type: 'blob', size: 20 },
      { path: 'skills/demo/scripts/run.sh', type: 'blob', size: 30 },
      // Belongs to a different skill in the same repository.
      { path: 'skills/other/SKILL.md', type: 'blob', size: 10 },
      // A tree entry, not a file.
      { path: 'skills/demo/references', type: 'tree' },
    ]);
    const { listSkillDirectory } = await import('../../src/registry.js');

    const files = await listSkillDirectory(URL_UNDER_TEST);

    assert.deepStrictEqual(
      files?.map((f) => f.path).sort(),
      ['SKILL.md', 'references/api.md', 'scripts/run.sh']
    );
  });

  it('accepts a URL that already points at SKILL.md', async () => {
    stubGitHub([
      { path: 'skills/demo/SKILL.md', type: 'blob', size: 10 },
      { path: 'skills/demo/notes.md', type: 'blob', size: 20 },
    ]);
    const { listSkillDirectory } = await import('../../src/registry.js');

    const files = await listSkillDirectory(`${URL_UNDER_TEST}/SKILL.md`);

    assert.deepStrictEqual(files?.map((f) => f.path).sort(), ['SKILL.md', 'notes.md']);
  });

  it('returns null rather than failing when the listing is unavailable', async () => {
    // The API is rate limited without a token. A skill installed from its
    // SKILL.md alone still beats a failed install.
    stubGitHub(null);
    const { listSkillDirectory } = await import('../../src/registry.js');

    assert.strictEqual(await listSkillDirectory(URL_UNDER_TEST), null);
  });

  it('returns null for a URL it cannot parse', async () => {
    const { listSkillDirectory } = await import('../../src/registry.js');

    assert.strictEqual(await listSkillDirectory('https://github.com/acme/repo'), null);
  });
});

describe('Fetching one file of a skill', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks raw.githubusercontent.com for the path under the skill', async () => {
    const asked = stubGitHub([]);
    const { downloadSkillFile } = await import('../../src/registry.js');

    const body = await downloadSkillFile(URL_UNDER_TEST, 'references/api.md');

    assert.strictEqual(body?.toString(), 'file body');
    assert.strictEqual(
      asked[0],
      'https://raw.githubusercontent.com/acme/repo/main/skills/demo/references/api.md'
    );
  });

  it('fetches from no host but GitHub', async () => {
    const asked = stubGitHub([]);
    const { downloadSkillFile } = await import('../../src/registry.js');

    const body = await downloadSkillFile(
      'https://evil.example.com/acme/repo/tree/main/skills/demo',
      'SKILL.md'
    );

    assert.strictEqual(body, null);
    assert.deepStrictEqual(asked, [], 'nothing should have been requested');
  });
});

describe('Reporting a source that is gone', () => {
  beforeEach(() => {
    globalThis.fetch = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('says the skill moved rather than blaming the URL', async () => {
    // The URL came from the catalog, where it worked at install time. "Check
    // the URL and try again" sent people looking in the wrong place; the seven
    // iwsdk skills had simply been relocated inside their repository.
    const { downloadSkillContent } = await import('../../src/registry.js');

    await assert.rejects(() => downloadSkillContent(URL_UNDER_TEST), /gone \(404\)|moved/);
  });
});
