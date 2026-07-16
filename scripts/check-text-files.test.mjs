import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCaseInsensitivePathCollisions,
  inspectTextBuffer,
  isTrackedTextPath,
} from './check-text-files.mjs';

test('tracked text path detection excludes binary assets', () => {
  assert.equal(isTrackedTextPath('apps/cli/src/index.ts'), true);
  assert.equal(isTrackedTextPath('DOCS/README.md'), true);
  assert.equal(isTrackedTextPath('.prettierignore'), true);
  assert.equal(isTrackedTextPath('apps/desktop/build/icon.png'), false);
});

test('text inspection rejects BOM, carriage returns, and missing final LF', () => {
  assert.deepEqual(inspectTextBuffer(Buffer.from('valid UTF-8\n')), []);
  assert.deepEqual(inspectTextBuffer(Buffer.from('\ufeffline\r\n')), [
    'starts with a UTF-8 BOM',
    'contains carriage-return bytes; tracked text must use LF',
  ]);
  assert.deepEqual(inspectTextBuffer(Buffer.from('missing final newline')), [
    'does not end with LF',
  ]);
});

test('case-insensitive collision detection protects Windows and default macOS filesystems', () => {
  assert.deepEqual(
    findCaseInsensitivePathCollisions(['src/Example.ts', 'src/example.ts', 'src/other.ts']),
    [['src/Example.ts', 'src/example.ts']],
  );
});
