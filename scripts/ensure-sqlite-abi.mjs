#!/usr/bin/env node
// Cache better-sqlite3 per ABI, but prove compatibility with the requested
// runtime before accepting an installed, restored, or rebuilt binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export function ensureSqliteAbi(
  target,
  { repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), spawn = spawnSync } = {},
) {
  if (target !== 'node' && target !== 'electron') {
    throw new Error('Usage: node scripts/ensure-sqlite-abi.mjs <node|electron>');
  }

  const require = createRequire(join(repoRoot, 'package.json'));
  const pkgJsonPath = require.resolve('better-sqlite3/package.json');
  const pkgVersion = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
  const binaryPath = join(dirname(pkgJsonPath), 'build', 'Release', 'better_sqlite3.node');
  const cacheDir = join(repoRoot, 'node_modules', '.cache', 'better-sqlite3-abi');
  // Loading Electron is deliberately lazy: Node tests also work in installs
  // without Electron, and importing this module never probes native modules.
  const runtimePath = target === 'node' ? process.execPath : require('electron');
  const runtimeEnv =
    target === 'electron' ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;

  const runtimeProbe = spawn(runtimePath, ['-p', 'process.versions.modules'], {
    cwd: repoRoot,
    env: runtimeEnv,
    encoding: 'utf8',
  });
  const targetAbi = (runtimeProbe.stdout || '').trim();
  if (runtimeProbe.status !== 0 || !/^\d+$/.test(targetAbi)) {
    throw new Error(
      `[sqlite-abi] could not detect ${target} ABI: ${runtimeProbe.error?.message || runtimeProbe.stderr || 'runtime probe failed'}`,
    );
  }

  const cachedBinaryPath = (abi) =>
    join(
      cacheDir,
      `better_sqlite3-v${pkgVersion}-abi${abi}-${process.platform}-${process.arch}.node`,
    );
  const saveToCache = (abi) => {
    mkdirSync(cacheDir, { recursive: true });
    copyFileSync(binaryPath, cachedBinaryPath(abi));
  };
  const isCompatible = () => {
    if (!existsSync(binaryPath)) return false;
    const probe = spawn(runtimePath, ['-e', `require(${JSON.stringify(binaryPath)})`], {
      cwd: repoRoot,
      env: runtimeEnv,
      encoding: 'utf8',
    });
    return !probe.error && probe.status === 0;
  };

  // A Node mismatch identifies the installed binary's ABI, not its runtime.
  // Preserve it for a later switch; every cache restore is validated below.
  if (existsSync(binaryPath)) {
    const probe = spawn(
      process.execPath,
      [
        '-e',
        `try { require(${JSON.stringify(binaryPath)}); console.log('ABI:' + process.versions.modules); }
         catch (e) { const m = /NODE_MODULE_VERSION (\\d+)/.exec(String(e.message)); if (m) console.log('ABI:' + m[1]); }`,
      ],
      { encoding: 'utf8' },
    );
    const installedAbi = /^ABI:(\d+)$/.exec((probe.stdout || '').trim())?.[1];
    if (installedAbi && !existsSync(cachedBinaryPath(installedAbi))) {
      saveToCache(installedAbi);
    }
  }

  if (isCompatible()) {
    saveToCache(targetAbi);
    console.log(`[sqlite-abi] already built for ${target} (ABI ${targetAbi})`);
    return;
  }

  if (existsSync(cachedBinaryPath(targetAbi))) {
    mkdirSync(dirname(binaryPath), { recursive: true });
    copyFileSync(cachedBinaryPath(targetAbi), binaryPath);
    if (isCompatible()) {
      console.log(`[sqlite-abi] swapped in cached ${target} binary (ABI ${targetAbi})`);
      return;
    }
    console.warn(`[sqlite-abi] cached ${target} binary failed validation; rebuilding...`);
  } else {
    console.log(`[sqlite-abi] no cached binary for ${target}, rebuilding...`);
  }

  const command =
    target === 'node' ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath;
  const args =
    target === 'node' ? ['rebuild', 'better-sqlite3'] : [join('scripts', 'rebuild-electron.mjs')];
  const result = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: target === 'node' && process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[sqlite-abi] ${command} ${args.join(' ')} failed: ${result.error?.message || result.status}`,
    );
  }
  if (!isCompatible()) {
    throw new Error(
      `[sqlite-abi] rebuild completed but the binary cannot load in ${target} (ABI ${targetAbi})`,
    );
  }
  saveToCache(targetAbi);
  console.log(`[sqlite-abi] rebuilt for ${target} (ABI ${targetAbi}) and cached`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    ensureSqliteAbi(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
