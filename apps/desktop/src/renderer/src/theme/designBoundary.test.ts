import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const renderer = path.resolve('apps/desktop/src/renderer/src');

function violations(file: string, text: string): string[] {
  const issues: string[] = [];
  if (file !== 'theme/palettes.css') {
    if (/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(\s*[\d.]/i.test(text))
      issues.push('define literal colors in theme/palettes.css');
    if (/--color-[\w-]+\s*:/.test(text)) issues.push('declare palette roles in theme/palettes.css');
  }
  // The catalog's numeric preference IDs are not CSS font-size declarations.
  if (file !== 'theme/typography.css' && file !== 'theme/typography.ts') {
    if (/\b(?:text|font|leading)-\[/.test(text)) issues.push('use the named typography scale');
    if (
      /\bfont(?:Size|Family)\s*(?:=|:)\s*["'`{]*\d|\bfont-size\s*:\s*\d|@font-face|@fontsource/.test(
        text,
      )
    )
      issues.push('define fonts and font sizes in theme/typography.css');
  }
  if (
    file !== 'theme/metrics.css' &&
    /--(?:radius-|control-size-|control-inset-)[\w-]+\s*:/.test(text)
  )
    issues.push('define control geometry in theme/metrics.css');
  return issues;
}

it('keeps palette, typography and control geometry values in their single owners', () => {
  const found: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file)) {
        const relative = path.relative(renderer, file).replaceAll('\\', '/');
        found.push(
          ...violations(relative, readFileSync(file, 'utf8')).map(
            (message) => `${relative}: ${message}`,
          ),
        );
      }
    }
  }
  walk(renderer);
  expect(found).toEqual([]);
});

it('rejects local design values while allowing semantic tokens and layout', () => {
  for (const source of [
    '<div className="text-[13px]" />',
    '<div style={{ color: "#ff8000" }} />',
    '.panel { --color-text: 10 20 30; }',
    '.panel { --radius-control: 12px; }',
    '.body { font-size: 13px; }',
  ])
    expect(violations('components/example.tsx', source).length).toBeGreaterThan(0);
  expect(
    violations('components/example.tsx', '<div className="text-xs px-3 bg-surface" />'),
  ).toEqual([]);
  expect(
    violations(
      'components/example.css',
      '.body { color: rgb(var(--color-text)); font-size: var(--font-size-sm); }',
    ),
  ).toEqual([]);
});
