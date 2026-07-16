import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RENDERER_ROOT = path.join(ROOT, 'apps/desktop/src/renderer/src');
const HARD_CODED_COLOR_RE =
  /(bg|text|border|ring|from|to)-(gray|blue|emerald|red|amber|purple|slate|indigo|yellow|green|teal|orange|pink|rose|lime|cyan|sky|violet|fuchsia|stone|neutral|zinc)-/g;

const errors = [];

function shouldCheck(filePath) {
  if (!filePath.endsWith('.tsx')) return false;
  if (filePath.endsWith('.test.tsx')) return false;
  if (filePath.includes(`${path.sep}components${path.sep}ui${path.sep}`)) return false;
  return true;
}

function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!shouldCheck(fullPath)) continue;

    const text = fs.readFileSync(fullPath, 'utf8');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      HARD_CODED_COLOR_RE.lastIndex = 0;
      const match = HARD_CODED_COLOR_RE.exec(line);
      if (!match) return;
      const relPath = path.relative(ROOT, fullPath);
      errors.push(`${relPath}:${index + 1} -> ${line.trim()}`);
    });
  }
}

walk(RENDERER_ROOT);

if (errors.length > 0) {
  console.error(
    '[gate:style] Hard-coded color utility classes found. Use semantic tokens/classes instead.',
  );
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log('[gate:style] Style guard passed.');
