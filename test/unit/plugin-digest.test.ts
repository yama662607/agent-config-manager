import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Claude Desktop stamps `lastUpdated` into a plugin's `manifest.json` whenever
 * it touches the file — observed moving 73 minutes with every skill byte
 * identical. Hashing that made `acm doctor` report `anthropic-skills` as
 * changed roughly hourly, and a signal that fires when nothing happened is one
 * people learn to ignore.
 */

const ROOT = path.join(os.tmpdir(), 'acm-plugin-digest-test');

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function buildPlugin(manifest: unknown, skillBody = '# demo\n'): Promise<void> {
  await fs.rm(ROOT, { recursive: true, force: true });
  await write(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await write(path.join(ROOT, 'skills', 'demo', 'SKILL.md'), skillBody);
}

const MANIFEST = {
  lastUpdated: 1786259465302,
  skills: [{ skillId: 'demo', name: 'demo', enabled: true, updatedAt: '2026-08-03T20:31:43Z' }],
};

describe('Digesting a plugin source', () => {
  afterEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it("ignores the application's own write timestamp", async () => {
    const { digestPluginSource } = await import('../../src/desktop-scanner.js');

    await buildPlugin(MANIFEST);
    const before = await digestPluginSource(ROOT);

    await buildPlugin({ ...MANIFEST, lastUpdated: 1786263851057 });
    const after = await digestPluginSource(ROOT);

    assert.strictEqual(after, before, 'a rewritten timestamp is not a change');
  });

  it('still notices a skill whose contents changed', async () => {
    const { digestPluginSource } = await import('../../src/desktop-scanner.js');

    await buildPlugin(MANIFEST);
    const before = await digestPluginSource(ROOT);

    await buildPlugin(MANIFEST, '# demo, revised\n');
    const after = await digestPluginSource(ROOT);

    assert.notStrictEqual(after, before);
  });

  it('still notices a skill being disabled or re-dated', async () => {
    // Only the top-level write timestamp is dropped. The per-skill entries
    // beside it move when the plugin really does.
    const { digestPluginSource } = await import('../../src/desktop-scanner.js');

    await buildPlugin(MANIFEST);
    const before = await digestPluginSource(ROOT);

    await buildPlugin({
      ...MANIFEST,
      skills: [{ ...MANIFEST.skills[0], enabled: false }],
    });

    assert.notStrictEqual(await digestPluginSource(ROOT), before);
  });

  it('hashes a manifest that is not JSON as it stands', async () => {
    const { digestPluginSource } = await import('../../src/desktop-scanner.js');

    await buildPlugin(MANIFEST);
    await write(path.join(ROOT, 'manifest.json'), 'not json at all');
    const before = await digestPluginSource(ROOT);

    await write(path.join(ROOT, 'manifest.json'), 'not json either');

    assert.notStrictEqual(await digestPluginSource(ROOT), before);
  });

  it('returns null for a directory that is not there', async () => {
    const { digestPluginSource } = await import('../../src/desktop-scanner.js');

    assert.strictEqual(await digestPluginSource(path.join(ROOT, 'nope')), null);
  });
});

describe('Digesting a skill directory', () => {
  beforeEach(async () => {
    await buildPlugin(MANIFEST);
  });

  afterEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('hashes every byte when no normaliser is given', async () => {
    // Skills have no application writing bookkeeping into them, so the plain
    // digest must stay exact.
    const { digestSkillDir } = await import('../../src/skill-placement.js');

    const before = await digestSkillDir(ROOT);
    await write(path.join(ROOT, 'manifest.json'), JSON.stringify({ ...MANIFEST, lastUpdated: 1 }));

    assert.notStrictEqual(await digestSkillDir(ROOT), before);
  });
});
