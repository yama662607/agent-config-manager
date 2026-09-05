import { readFileSync, mkdirSync, writeFileSync, readdirSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { platforms } from './native-platforms.mjs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const check = spawnSync(process.execPath, ['scripts/check-package.mjs', '--all'], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);
mkdirSync('release', { recursive: true });
for (const [platform, target] of Object.entries(platforms)) {
  const executable = platform.startsWith('win32') ? 'acm.exe' : 'acm';
  chmodSync(join('native', platform, executable), 0o755);
  const output = join('release', `acm-v${version}-${target}.tar.gz`);
  const archive = spawnSync('tar', ['-czf', output, '-C', join('native', platform), executable, 'manifest.json'], { stdio: 'inherit' });
  if (archive.status !== 0) process.exit(archive.status ?? 1);
}
const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', 'release'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (pack.status !== 0) process.exit(pack.status ?? 1);
const checksums = readdirSync('release').filter(name => name.endsWith('.gz') || name.endsWith('.tgz')).sort().map(name => `${createHash('sha256').update(readFileSync(join('release', name))).digest('hex')}  ${name}`);
writeFileSync('release/SHA256SUMS', checksums.join('\n') + '\n');
