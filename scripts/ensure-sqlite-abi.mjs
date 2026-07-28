#!/usr/bin/env node
// Ensures node_modules/better-sqlite3 is compiled for the requested runtime
// (node for vitest, electron for the app) without recompiling on every
// switch: each ABI's binary is cached after its first build, so subsequent
// switches are a millisecond file copy instead of a ~10s rebuild.
//
// Usage: node scripts/ensure-sqlite-abi.mjs <node|electron>

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('Usage: node scripts/ensure-sqlite-abi.mjs <node|electron>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(repoRoot, 'package.json'));

const pkgJsonPath = require.resolve('better-sqlite3/package.json');
const pkgDir = dirname(pkgJsonPath);
const pkgVersion = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
const binaryPath = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');

const cacheDir = join(repoRoot, 'node_modules', '.cache', 'better-sqlite3-abi');
const metaPath = join(cacheDir, 'meta.json');

const electronVersion = (() => {
  try {
    return JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

function cachedBinaryPath(abi) {
  return join(
    cacheDir,
    `better_sqlite3-v${pkgVersion}-abi${abi}-${process.platform}-${process.arch}.node`,
  );
}

function readMeta() {
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

// Detect the ABI of the currently installed binary by dlopen-ing the .node
// file itself under this Node (requiring the package would NOT work:
// better-sqlite3 loads its binding lazily on first `new Database()`).
// Success reports Node's own ABI; the mismatch error names the binary's ABI.
function detectInstalledAbi() {
  if (!existsSync(binaryPath)) return null;
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `try { require(${JSON.stringify(binaryPath)}); console.log('OK:' + process.versions.modules); }
       catch (e) { const m = /NODE_MODULE_VERSION (\\d+)/.exec(String(e.message)); console.log(m ? 'ABI:' + m[1] : 'UNKNOWN'); }`,
    ],
    { encoding: 'utf8' },
  );
  const out = (probe.stdout || '').trim();
  if (out.startsWith('OK:')) return out.slice(3);
  if (out.startsWith('ABI:')) return out.slice(4);
  return null;
}

function saveToCache(abi) {
  mkdirSync(cacheDir, { recursive: true });
  copyFileSync(binaryPath, cachedBinaryPath(abi));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`[sqlite-abi] ${command} ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
}

const nodeAbi = process.versions.modules;
const meta = readMeta();
const installedAbi = detectInstalledAbi();

// Opportunistically cache whatever is installed right now, so a binary built
// outside this script (raw electron-rebuild, npm rebuild) is not lost.
if (installedAbi && !existsSync(cachedBinaryPath(installedAbi))) {
  saveToCache(installedAbi);
}
// A non-node ABI can only have come from an electron-rebuild of the pinned
// electron version; remember the mapping so future runs can trust the cache.
if (installedAbi && installedAbi !== nodeAbi && !meta[`electron-${electronVersion}`]) {
  meta[`electron-${electronVersion}`] = installedAbi;
  writeMeta(meta);
}

const targetAbi = target === 'node' ? nodeAbi : meta[`electron-${electronVersion}`];

if (targetAbi && installedAbi === targetAbi) {
  console.log(`[sqlite-abi] already built for ${target} (ABI ${targetAbi})`);
  process.exit(0);
}

if (targetAbi && existsSync(cachedBinaryPath(targetAbi))) {
  copyFileSync(cachedBinaryPath(targetAbi), binaryPath);
  console.log(`[sqlite-abi] swapped in cached ${target} binary (ABI ${targetAbi})`);
  process.exit(0);
}

// Cache miss: do the real (slow) rebuild once, then remember the result.
console.log(`[sqlite-abi] no cached binary for ${target}, rebuilding...`);
if (target === 'node') {
  run('npm', ['rebuild', 'better-sqlite3']);
} else {
  run('node', [join('scripts', 'rebuild-electron.mjs')]);
}

const rebuiltAbi = detectInstalledAbi();
if (!rebuiltAbi) {
  console.error('[sqlite-abi] rebuild completed but the binary could not be probed');
  process.exit(1);
}
saveToCache(rebuiltAbi);
if (target === 'electron') {
  meta[`electron-${electronVersion}`] = rebuiltAbi;
  writeMeta(meta);
}
console.log(`[sqlite-abi] rebuilt for ${target} (ABI ${rebuiltAbi}) and cached`);
