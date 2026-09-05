import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const temp = mkdtempSync(join(tmpdir(), 'acm-package-'));
try {
  const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--pack-destination', temp], { encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(pack.status, 0, pack.stderr);
  const metadata = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[\n')))[0];
  assert.ok(!metadata.files.some(file => file.path.endsWith('.ts') || file.path.startsWith('src/')), 'npm must ship only the native distribution');
  const extracted = join(temp, 'unpacked'); mkdirSync(extracted);
  const tar = spawnSync('tar', ['-xzf', join(temp, metadata.filename), '-C', extracted], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const launcher = join(extracted, 'package/bin/acm.cjs');
  const home = join(temp, 'home'); mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, ACM_CATALOG_DIR: join(temp, 'catalog') };
  for (const args of [['--version'], ['--help'], ['--catalog', 'mcp', 'list', '--json']]) {
    const out = spawnSync(process.execPath, [launcher, ...args], { env, cwd: temp, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    if (args.includes('--json')) assert.deepEqual(JSON.parse(out.stdout), []);
  }
  const invalid = spawnSync(process.execPath, [launcher, '--bad-option'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  console.log('Packaged npm launcher smoke tests passed');
} finally { rmSync(temp, { recursive: true, force: true }); }
