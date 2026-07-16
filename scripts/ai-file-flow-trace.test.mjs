import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'ai-file-flow-trace.mjs');

test('ai file flow trace script exposes help', () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /ai-file-flow-trace\.mjs/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--project-name <name>/);
  assert.match(result.stdout, /--file-id <id>/);
  assert.match(result.stdout, /--file <path>/);
  assert.match(result.stdout, /--source-col <n>/);
  assert.match(result.stdout, /--target-col <n>/);
  assert.match(result.stdout, /--preview-limit <n>/);
  assert.match(result.stdout, /--target-scope <scope>/);
  assert.match(result.stdout, /Example project/);
  assert.match(result.stdout, /example-input\.xlsx/);
  assert.equal(result.stdout.includes('C:\\path'), false);
});
