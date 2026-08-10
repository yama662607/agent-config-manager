import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * `acm mcp adopt` records a local server's absolute command with a warning, and
 * `acm mcp update` then refused to deploy the very recipe adopt had written:
 * "Command path not allowed. Use npx, npm, node, or relative paths."
 *
 * A recipe you can record but never apply is worse than no rule, and the rule
 * bought little — `npx <anything>` runs arbitrary code, so an attacker who
 * could set the command was never stopped by the allowlist. What is enforced
 * now is the part that matters: nothing that would run something else besides
 * itself if the command ever passed through a shell.
 */

const ROOT = path.join(os.tmpdir(), 'acm-command-validation-test');

const CONFIG = path.join(ROOT, '.mcp.json');

async function addServer(command: string, args: string[] = []): Promise<void> {
  const { addMcpToConfig } = await import('../../src/config-adapters.js');
  await addMcpToConfig('claude', CONFIG, 'probe', { transport: 'stdio', command, args });
}

describe('Validating an MCP command', () => {
  beforeEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(ROOT, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('accepts an absolute path, which is how a local server is launched', async () => {
    await addServer('/opt/local/bin/kanade-mcp');

    const config = JSON.parse(await fs.readFile(CONFIG, 'utf8'));
    assert.strictEqual(config.mcpServers.probe.command, '/opt/local/bin/kanade-mcp');
  });

  it('accepts a path with spaces in it', async () => {
    // Codex writes one for its own bundled server.
    await addServer('./Codex Computer Use.app/Contents/MacOS/client');

    const config = JSON.parse(await fs.readFile(CONFIG, 'utf8'));
    assert.match(config.mcpServers.probe.command, /Codex Computer Use/);
  });

  it('still accepts a bare command resolved through PATH', async () => {
    await addServer('npx', ['-y', '@demo/server']);

    const config = JSON.parse(await fs.readFile(CONFIG, 'utf8'));
    assert.strictEqual(config.mcpServers.probe.command, 'npx');
  });

  it('refuses shell metacharacters', async () => {
    for (const command of ['sh -c "x"; rm -rf /', 'foo|bar', 'foo`id`', 'foo$(id)', 'foo>out']) {
      await assert.rejects(
        () => addServer(command),
        /metacharacters/,
        `${command} should be refused`
      );
    }
  });

  it('refuses newlines and null bytes', async () => {
    // A newline splits a command in most files that hold one.
    await assert.rejects(() => addServer('foo\nbar'), /newlines or null bytes/);
    await assert.rejects(() => addServer('foo\0bar'), /newlines or null bytes/);
  });

  it('refuses an absurdly long command', async () => {
    // An empty command is not checked, because absent is how a remote server
    // says it has none.
    await assert.rejects(() => addServer('a'.repeat(201)), /1-200 characters/);
  });

  it('does not require the command to exist', async () => {
    // `acm` can configure a machine before its tools are installed. Whether a
    // command resolves is `acm doctor`'s question, not this one's.
    await addServer('/nowhere/at/all/server');

    const config = JSON.parse(await fs.readFile(CONFIG, 'utf8'));
    assert.strictEqual(config.mcpServers.probe.command, '/nowhere/at/all/server');
  });
});
