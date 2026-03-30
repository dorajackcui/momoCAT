#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === 'win32'
  });
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['electron-rebuild', '-v', '28.3.3', '-f', '-w', 'better-sqlite3', ...process.argv.slice(2)];
const cwd = process.cwd();
const env = { ...process.env, HOME: cwd };

if (process.platform === 'win32' && !env.USERPROFILE) {
  env.USERPROFILE = cwd;
}

const result = spawnCommandSync(npxCmd, args, {
  cwd,
  env,
  stdio: 'inherit'
});

if (result.error) {
  console.error(`[rebuild:electron] Failed to start ${npxCmd}:`, result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
