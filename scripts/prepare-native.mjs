import { copyFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { platforms } from './native-platforms.mjs';
const platform = process.argv[2] ?? `${process.platform}-${process.arch}`;
const target = platforms[platform];
if (!target) throw new Error(`Unsupported platform: ${platform}`);
const executable = platform.startsWith('win32') ? 'acm.exe' : 'acm';
const source = process.argv[3] ?? join('target', 'release', executable);
const directory = join('native', platform);
const binary = join(directory, executable);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (platform === `${process.platform}-${process.arch}`) {
  const output = spawnSync(source, ['--version'], { encoding: 'utf8' });
  if (output.status !== 0 || output.stdout.trim() !== `acm ${pkg.version}`) throw new Error('Native binary version does not match package.json');
}
const contents = readFileSync(source);
if (contents.includes(Buffer.from(homedir()))) throw new Error('Native binary includes the build home path; use just build or scripts/build-native.mjs');
mkdirSync(directory, { recursive: true });
copyFileSync(source, binary);
chmodSync(binary, 0o755);
const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: pkg.version, platform, target, executable, sha256 }, null, 2) + '\n');
console.log(`Prepared ${platform} (${target})`);
