import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = path.resolve('src/cli.ts');

/**
 * `--help` must never do the thing it is asking about.
 *
 * `acm scan --help` had no help text of its own, fell through to the handler,
 * and ran a full scan — registering 66 skills and 25 servers into a catalog
 * whose owner had asked a question, not given an instruction.
 */
async function acm(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 60_000,
    });
    return stdout + stderr;
  } catch (error: any) {
    return (error.stdout ?? '') + (error.stderr ?? '');
  }
}

describe('Asking a command for help', () => {
  const commands = ['init', 'catalog', 'mcp', 'skill', 'plugin', 'validate', 'doctor', 'scan'];

  for (const command of commands) {
    it(`describes \`${command}\` instead of running it`, async () => {
      const output = await acm([command, '--help']);
      assert.match(output, new RegExp(`acm ${command}`), `${command} --help should print its own help`);
    });
  }

  it('answers -h the same way', async () => {
    assert.match(await acm(['scan', '-h']), /acm scan/);
  });
});
