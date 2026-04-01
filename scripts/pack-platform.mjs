#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === 'win32'
  });
}

function usage() {
  console.log(`Usage:
  node scripts/pack-platform.mjs --platform <win|mac> [--dry-run]
  node scripts/pack-platform.mjs --platform=<win|mac> [--dry-run]`);
}

function parseArgs(argv) {
  let platform = '';
  let dryRun = false;
  let passThroughArgs = [];

  const delimiterIndex = argv.indexOf('--');
  const parsedArgs = delimiterIndex >= 0 ? argv.slice(0, delimiterIndex) : argv;
  if (delimiterIndex >= 0) {
    passThroughArgs = argv.slice(delimiterIndex + 1);
  }

  for (let i = 0; i < parsedArgs.length; i += 1) {
    const arg = parsedArgs[i];

    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1] || '';
      continue;
    }
    if (arg === '--platform') {
      platform = parsedArgs[i + 1] || '';
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!platform) {
    throw new Error('Missing --platform argument, expected "win" or "mac".');
  }

  return { platform, dryRun, passThroughArgs };
}

function expectedNodePlatform(platformArg) {
  if (platformArg === 'win') return 'win32';
  if (platformArg === 'mac') return 'darwin';
  throw new Error(`Unsupported platform "${platformArg}", expected "win" or "mac".`);
}

function main() {
  const { platform, dryRun, passThroughArgs } = parseArgs(process.argv.slice(2));
  const expected = expectedNodePlatform(platform);

  if (process.platform !== expected) {
    const platformLabel = platform === 'win' ? 'Windows' : 'macOS';
    throw new Error(`pack:${platform} can only run on ${platformLabel}. Current platform: ${process.platform}.`);
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = ['run', 'pack'];
  if (passThroughArgs.length > 0) {
    npmArgs.push('--', ...passThroughArgs);
  }

  if (dryRun) {
    console.log(`[dry-run] ${npmCmd} ${npmArgs.join(' ')}`);
    return;
  }

  const result = spawnCommandSync(npmCmd, npmArgs, {
    stdio: 'inherit'
  });

  if (result.error) {
    throw new Error(`Failed to start ${npmCmd}: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
