import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { ensureSqliteAbi } from './ensure-sqlite-abi.mjs';

function fixture(t, { installedAbi = process.versions.modules, electron = true, rebuiltAbi } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'momocat-sqlite-abi-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const binaryPath = join(
    repoRoot,
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  const cacheDir = join(repoRoot, 'node_modules/.cache/better-sqlite3-abi');
  const electronPath = join(repoRoot, 'electron.exe');
  const electronAbi = '124';
  const calls = [];
  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  write(join(repoRoot, 'package.json'), '{}');
  write(join(repoRoot, 'node_modules/better-sqlite3/package.json'), '{"version":"12.6.2"}');
  write(binaryPath, installedAbi);
  if (electron) {
    write(
      join(repoRoot, 'node_modules/electron/index.js'),
      `module.exports = ${JSON.stringify(electronPath)};`,
    );
  }
  const cachePath = (abi) =>
    join(cacheDir, `better_sqlite3-v12.6.2-abi${abi}-${process.platform}-${process.arch}.node`);
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const runtimeAbi = command === electronPath ? electronAbi : process.versions.modules;
    if (args[0] === '-p') return { status: 0, stdout: runtimeAbi };
    if (args[0] === '-e') {
      const binaryAbi = readFileSync(binaryPath, 'utf8');
      if (args[1].includes("console.log('ABI:'")) {
        return { status: 0, stdout: /^\d+$/.test(binaryAbi) ? `ABI:${binaryAbi}` : '' };
      }
      return { status: binaryAbi === runtimeAbi ? 0 : 1 };
    }
    write(
      binaryPath,
      rebuiltAbi ?? (args[0] === 'rebuild' ? process.versions.modules : electronAbi),
    );
    return { status: 0 };
  };
  const rebuildCalls = () => calls.filter(({ args }) => args[0] !== '-p' && args[0] !== '-e');
  return {
    repoRoot,
    binaryPath,
    electronPath,
    electronAbi,
    calls,
    spawn,
    write,
    cachePath,
    cacheDir,
    rebuildCalls,
  };
}

test('Node target does not load Electron or rebuild an already compatible binary', (t) => {
  const f = fixture(t, { electron: false });
  ensureSqliteAbi('node', f);
  assert.equal(f.rebuildCalls().length, 0);
  assert.equal(
    readFileSync(f.cachePath(process.versions.modules), 'utf8'),
    process.versions.modules,
  );
});

test('detects the actual Electron ABI instead of trusting another Node ABI or old metadata', (t) => {
  const f = fixture(t, { installedAbi: '127' });
  f.write(join(f.cacheDir, 'meta.json'), '{"electron-28.3.3":"127"}');
  ensureSqliteAbi('electron', f);
  assert.equal(f.rebuildCalls().length, 1);
  assert.equal(readFileSync(f.binaryPath, 'utf8'), f.electronAbi);
  assert.equal(readFileSync(f.cachePath('127'), 'utf8'), '127');
  for (const call of f.calls.filter(({ command }) => command === f.electronPath)) {
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
  }
});

test('restores and validates a cached binary for the requested runtime', (t) => {
  const f = fixture(t);
  f.write(f.cachePath(f.electronAbi), f.electronAbi);
  ensureSqliteAbi('electron', f);
  assert.equal(f.rebuildCalls().length, 0);
  assert.equal(readFileSync(f.binaryPath, 'utf8'), f.electronAbi);
  assert.equal(
    f.calls.filter(({ command, args }) => command === f.electronPath && args[0] === '-e').length,
    2,
  );
});

test('rebuilds when the cached binary has the expected filename but cannot load', (t) => {
  const f = fixture(t);
  f.write(f.cachePath(f.electronAbi), 'broken');
  ensureSqliteAbi('electron', f);
  assert.equal(f.rebuildCalls().length, 1);
  assert.equal(readFileSync(f.cachePath(f.electronAbi), 'utf8'), f.electronAbi);
});

test('rejects a successful rebuild whose binary still cannot load in the target runtime', (t) => {
  const f = fixture(t, { rebuiltAbi: '127' });
  assert.throws(() => ensureSqliteAbi('electron', f), /cannot load in electron/);
  assert.equal(f.rebuildCalls().length, 1);
});

test('fails before replacing a binary when the target runtime probe fails', (t) => {
  const f = fixture(t);
  const original = readFileSync(f.binaryPath, 'utf8');
  assert.throws(
    () =>
      ensureSqliteAbi('electron', {
        ...f,
        spawn: () => ({ status: null, error: new Error('spawn failed') }),
      }),
    /could not detect electron ABI: spawn failed/,
  );
  assert.equal(readFileSync(f.binaryPath, 'utf8'), original);
});
