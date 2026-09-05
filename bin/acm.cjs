#!/usr/bin/env node
'use strict';
// npm supplies the executable aliases; all ACM behavior lives in the Rust binary.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const platform = `${process.platform}-${process.arch}`;
const binary = join(__dirname, '..', 'native', platform, process.platform === 'win32' ? 'acm.exe' : 'acm');
if (!existsSync(binary)) {
  console.error(`ACM native binary is unavailable for ${platform}. Install a complete release package or build from source with cargo install --path . --locked.`);
  process.exit(1);
}
const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`Cannot start ACM: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
