import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectMarkdownAnchors,
  findLocalScriptPaths,
  findMarkdownLinkErrors,
  findMarkdownTableErrors,
  findNpmRunCommands,
  splitMarkdownTableRow,
} from './check-docs.mjs';

test('markdown table parser treats unescaped pipes as column boundaries', () => {
  assert.deepEqual(splitMarkdownTableRow('| `window | window-partial` | meaning |'), [
    '`window',
    'window-partial`',
    'meaning',
  ]);
  assert.deepEqual(splitMarkdownTableRow('| `window \\| window-partial` | meaning |'), [
    '`window \\| window-partial`',
    'meaning',
  ]);
});

test('markdown table validation rejects rows that do not match the header', () => {
  const malformed = [
    '| Option | Meaning |',
    '| --- | --- | --- |',
    '| `window | window-partial` | Select a mode. |',
  ].join('\n');

  assert.deepEqual(findMarkdownTableErrors(malformed), [
    {
      line: 2,
      message: 'table delimiter has 3 columns; header has 2',
    },
    {
      line: 3,
      message: 'table row has 3 columns; header has 2',
    },
  ]);
  assert.deepEqual(
    findMarkdownTableErrors(
      '| Option | Meaning |\n| --- | --- |\n| `window` or `partial` | Select. |',
    ),
    [],
  );
});

test('npm command parsing preserves root and workspace context', () => {
  assert.deepEqual(
    findNpmRunCommands(
      [
        'npm run docs:check',
        'npm --silent run cli -- --help',
        'npm run test:e2e:smoke --workspace=apps/desktop',
      ].join('\n'),
    ).map(({ script, workspace }) => ({ script, workspace })),
    [
      { script: 'docs:check', workspace: undefined },
      { script: 'cli', workspace: undefined },
      { script: 'test:e2e:smoke', workspace: 'apps/desktop' },
    ],
  );
});

test('markdown headings produce GitHub-style unique anchors', () => {
  assert.deepEqual(
    [
      ...collectMarkdownAnchors(
        [
          '# Cross-platform Development',
          '## Repeated heading',
          '## Repeated heading',
          '```md',
          '# Not a real heading',
          '```',
        ].join('\n'),
      ),
    ],
    ['cross-platform-development', 'repeated-heading', 'repeated-heading-1'],
  );
});

test('markdown links validate same-file and cross-file fragments', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'momocat-doc-links-'));
  const sourcePath = path.join(directory, 'source.md');
  const targetPath = path.join(directory, 'target.md');
  const source = [
    '# Local section',
    '[valid local](#local-section)',
    '[missing local](#missing-local)',
    '[valid cross-file](target.md#target-section)',
    '[missing cross-file](target.md#missing-target)',
  ].join('\n');

  try {
    fs.writeFileSync(sourcePath, source, 'utf8');
    fs.writeFileSync(targetPath, '# Target section\n', 'utf8');

    assert.deepEqual(findMarkdownLinkErrors(sourcePath, source), {
      checkedLinks: 4,
      errors: [
        {
          line: 3,
          message: 'links to missing Markdown anchor #missing-local',
        },
        {
          line: 5,
          message: 'links to missing Markdown anchor target.md#missing-target',
        },
      ],
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local script path parsing finds package entrypoints', () => {
  assert.deepEqual(
    findLocalScriptPaths(
      'node scripts/check-docs.mjs && node scripts/generate-ai-prompt-templates.mjs --check',
    ),
    ['scripts/check-docs.mjs', 'scripts/generate-ai-prompt-templates.mjs'],
  );
});
