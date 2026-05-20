import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WARN_THRESHOLD = 450;
const FAIL_THRESHOLD = 600;

const TARGET_ROOTS = ['apps', 'packages'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'out', '.git']);
const EXCLUDED_SUFFIXES = ['.test.ts', '.test.tsx', '.d.ts'];

const LEGACY_ALLOWLIST = new Set([
  'packages/core/src/project/aiPromptTemplates.ts',
  'packages/db/src/repos/TMRepo.ts',
  'packages/localization/src/LocalizationEngine.ts',
]);

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, absPath).replaceAll('\\', '/');

    if (entry.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
      walk(absPath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    files.push(relPath);
  }
}

const files = [];
for (const root of TARGET_ROOTS) {
  const absRoot = path.join(ROOT, root);
  if (!fs.existsSync(absRoot)) continue;
  walk(absRoot, files);
}

let hasBlocking = false;
let warnedCount = 0;

for (const relPath of files.sort()) {
  const absPath = path.join(ROOT, relPath);
  const source = fs.readFileSync(absPath, 'utf8');
  const lineCount = source.split('\n').length;

  if (lineCount < WARN_THRESHOLD) continue;

  warnedCount += 1;
  if (lineCount >= FAIL_THRESHOLD && !LEGACY_ALLOWLIST.has(relPath)) {
    hasBlocking = true;
    console.error(`[gate:file-size] BLOCK ${lineCount} lines: ${relPath}`);
    continue;
  }

  if (lineCount >= FAIL_THRESHOLD && LEGACY_ALLOWLIST.has(relPath)) {
    console.warn(`[gate:file-size] LEGACY ${lineCount} lines (allowlisted): ${relPath}`);
    continue;
  }

  console.warn(`[gate:file-size] WARN ${lineCount} lines: ${relPath}`);
}

if (hasBlocking) {
  console.error(
    `[gate:file-size] Failed. Thresholds: warn >= ${WARN_THRESHOLD}, block >= ${FAIL_THRESHOLD}.`,
  );
  process.exit(1);
}

console.log(
  `[gate:file-size] Passed. Warn threshold: ${WARN_THRESHOLD}, block threshold: ${FAIL_THRESHOLD}, flagged: ${warnedCount}.`,
);
