import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
// Rust panic locations can include dependency source paths even in stripped binaries.
// Remap both the checkout and the build user's home before producing release assets.
const inherited = process.env.CARGO_ENCODED_RUSTFLAGS !== undefined
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
  : (process.env.RUSTFLAGS ?? '').split(/\s+/).filter(Boolean);
const flags = [...inherited, `--remap-path-prefix=${homedir()}=/build-home`, `--remap-path-prefix=${process.cwd()}=/acm`];
const result = spawnSync('cargo', ['build', '--release', '--locked', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
