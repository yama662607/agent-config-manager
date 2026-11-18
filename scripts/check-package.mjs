import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { platforms } from './native-platforms.mjs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const cargoVersion = readFileSync('Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.equal(pkg.version, cargoVersion, 'Cargo and npm versions must match');
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'npm launcher must have no runtime dependencies');
assert.deepEqual(new Set(Object.values(pkg.bin)), new Set(['bin/acm.cjs']));
assert.ok(!existsSync('src/cli.ts'), 'The TypeScript runtime must not remain');
const found = existsSync('native') ? readdirSync('native').filter(name => platforms[name]) : [];
if (process.argv.includes('--all')) assert.deepEqual(found.sort(), Object.keys(platforms).sort(), 'Release must contain all supported platforms');
if (!process.argv.includes('--source')) assert.ok(found.length, 'Run just prepare-native before packing');
for (const platform of found) {
  const dir = join('native', platform);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.target, platforms[platform]);
  assert.equal(manifest.platform, platform);
  const binary = join(dir, platform.startsWith('win32') ? 'acm.exe' : 'acm');
  assert.equal(createHash('sha256').update(readFileSync(binary)).digest('hex'), manifest.sha256, `Checksum mismatch for ${platform}`);
  if (platform === `${process.platform}-${process.arch}`) {
    const out = spawnSync(process.execPath, ['bin/acm.cjs', '--version'], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout.trim(), `acm ${pkg.version}`);
    const invalid = spawnSync(process.execPath, ['bin/acm.cjs', '--invalid-option'], { encoding: 'utf8' });
    assert.equal(invalid.status, 2, 'Launcher must propagate native exit status');
  }
}
console.log(`Package checks passed (${found.length} native platforms)`);
