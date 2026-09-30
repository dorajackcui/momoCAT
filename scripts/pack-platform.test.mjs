import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'pack-platform.mjs');
const require = createRequire(import.meta.url);

function currentPlatformArg() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return null;
}

test('pack-platform dry-run preserves publish args for desktop workspace pack', (t) => {
  const platform = currentPlatformArg();
  if (!platform) {
    t.skip('pack-platform only supports Windows and macOS');
    return;
  }

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--platform', platform, '--dry-run', '--', '--publish', 'always'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[dry-run\] npm(?:\.cmd)? run rebuild:electron/);
  assert.match(
    result.stdout,
    /\[dry-run\] npm(?:\.cmd)? run pack --workspace=apps\/desktop -- --publish always/,
  );
  assert.doesNotMatch(result.stdout, /run pack -- --publish always/);
});

test('pack-platform rejects a target that does not match the current host', () => {
  const otherPlatform = process.platform === 'win32' ? 'mac' : 'win';
  const expectedLabel = otherPlatform === 'win' ? 'Windows' : 'macOS';

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--platform', otherPlatform, '--dry-run'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`can only run on ${expectedLabel}`));
});

test('cloud packaging uses its own compile flavor and installer config without publishing', (t) => {
  const platform = currentPlatformArg();
  if (!platform) return t.skip('pack-platform only supports Windows and macOS');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--platform', platform, '--flavor=cloud', '--dry-run', '--', '--arm64'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /MOMOCAT_BUILD_FLAVOR=cloud npm(?:\.cmd)? run rebuild:electron/);
  assert.match(
    result.stdout,
    /MOMOCAT_BUILD_FLAVOR=cloud npm(?:\.cmd)? run pack --workspace=apps\/desktop -- --config electron-builder\.cloud\.cjs --publish never --arm64/,
  );
});

test('cloud installer identity and output cannot replace the ordinary installer', () => {
  const ordinary = require('../apps/desktop/package.json');
  const cloud = require('../apps/desktop/electron-builder.cloud.cjs');

  assert.equal(cloud.productName, 'momoCAT Cloud');
  assert.notEqual(cloud.appId, ordinary.build.appId);
  assert.notEqual(cloud.extraMetadata.name, ordinary.name);
  assert.equal(cloud.extraMetadata.name, 'simple-cat-tool-cloud');
  assert.equal(cloud.directories.output, 'dist-cloud');
  assert.equal(cloud.publish, null);
  assert.equal(cloud.mac.identity, '-');
  assert.equal(cloud.mac.notarize, false);
  assert.equal(cloud.mac.preAutoEntitlements, false);
  assert.equal(cloud.mac.hardenedRuntime, true);
  assert.equal(cloud.mac.entitlementsInherit, cloud.mac.entitlements);
  const entitlements = readFileSync(
    path.join(repoRoot, 'apps/desktop', cloud.mac.entitlements),
    'utf8',
  );
  assert.doesNotMatch(entitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.equal(ordinary.build.productName, 'momoCAT');
  assert.equal(ordinary.build.appId, 'com.simplecat.tool');
  assert.equal(ordinary.name, 'simple-cat-tool');
  assert.equal(ordinary.build.mac.identity, null);
  assert.equal(ordinary.build.publish[0].repo, 'momoCAT');
});

test('cloud packaging rejects publisher or identity overrides', (t) => {
  const platform = currentPlatformArg();
  if (!platform) return t.skip('pack-platform only supports Windows and macOS');

  for (const args of [
    ['--publish', 'always'],
    ['-p', 'always'],
    ['--config', 'package.json'],
    ['--config.appId=com.simplecat.tool'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--platform', platform, '--flavor=cloud', '--dry-run', '--', ...args],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cloud packaging owns its isolated config and cannot publish/);
  }
});
