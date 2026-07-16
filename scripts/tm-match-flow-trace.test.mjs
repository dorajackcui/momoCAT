import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'tm-match-flow-trace.mjs');

test('tm match flow trace script exposes help', () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /tm-match-flow-trace\.mjs/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--source <text>/);
  assert.match(result.stdout, /--segment-id <id>/);
  assert.match(result.stdout, /--src-hash <hash>/);
  assert.match(result.stdout, /--focus-src-hash <hashes>/);
  assert.match(result.stdout, /--no-recall-debug/);
});
