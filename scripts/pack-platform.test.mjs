import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'pack-platform.mjs');

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
