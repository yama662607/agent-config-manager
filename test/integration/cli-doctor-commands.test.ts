import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Codex writes its own bundled servers with a relative command and a working
 * directory to resolve it against — `./Codex Computer Use.app/…` with
 * `cwd = "."`. Checking that path from wherever `acm` happens to be running
 * reported a server that works fine as missing, which is how it showed up on a
 * second machine.
 */

const TEST_DIR = path.join(os.tmpdir(), 'acm-doctor-commands-test');
const HOME = path.join(TEST_DIR, 'home');
const CATALOG = path.join(TEST_DIR, 'catalog');
const CLI = path.resolve('src/cli.ts');

async function doctor(): Promise<string> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, 'doctor', '-H', '--offline'], {
      cwd: TEST_DIR,
      env: { ...process.env, HOME, ACM_CATALOG_DIR: CATALOG, NODE_ENV: 'test' },
    });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

async function writeCodexConfig(body: string[]): Promise<void> {
  const file = path.join(HOME, '.codex', 'config.toml');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body.join('\n') + '\n', 'utf8');
}

describe('Checking that a configured command exists', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(HOME, { recursive: true });
    await fs.mkdir(CATALOG, { recursive: true });
    await fs.writeFile(path.join(CATALOG, 'catalog.toml'), 'version = "1.0"\n', 'utf8');
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('does not call a relative command missing when only the app knows its directory', async () => {
    // `cwd = "."` resolves against whatever launches the server. Neither
    // "found" nor "missing" would be honest, so it is left alone.
    await writeCodexConfig([
      '[mcp_servers.bundled-thing]',
      'command = "./Some.app/Contents/MacOS/thing"',
      'args = ["mcp"]',
      'cwd = "."',
      'enabled = true',
    ]);

    assert.match(await doctor(), /Every configured command resolves/);
  });

  it('resolves a relative command against an absolute working directory', async () => {
    const bin = path.join(HOME, 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'real'), '#!/bin/sh\n', { mode: 0o755 });

    await writeCodexConfig([
      '[mcp_servers.present]',
      'command = "./bin/real"',
      'args = []',
      `cwd = "${HOME}"`,
      'enabled = true',
    ]);

    assert.match(await doctor(), /Every configured command resolves/);
  });

  it('still reports one that is genuinely absent', async () => {
    await writeCodexConfig([
      '[mcp_servers.broken]',
      'command = "./bin/does-not-exist"',
      'args = []',
      `cwd = "${HOME}"`,
      'enabled = true',
    ]);

    assert.match(await doctor(), /broken \(codex\): cannot find/);
  });

  it('leaves a disabled server out of the check', async () => {
    await writeCodexConfig([
      '[mcp_servers.broken]',
      'command = "/nowhere/at/all"',
      'args = []',
      'enabled = false',
    ]);

    assert.match(await doctor(), /Every configured command resolves/);
  });
});
