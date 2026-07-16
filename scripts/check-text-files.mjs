#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.plist',
  '.py',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const TEXT_BASENAMES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function isTrackedTextPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const basename = path.posix.basename(normalized);
  return (
    TEXT_BASENAMES.has(basename) ||
    TEXT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())
  );
}

export function inspectTextBuffer(buffer) {
  const problems = [];
  if (buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    problems.push('starts with a UTF-8 BOM');
  }
  if (buffer.includes(0x0d)) {
    problems.push('contains carriage-return bytes; tracked text must use LF');
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    problems.push('is not valid UTF-8');
  }

  if (buffer.length > 0 && buffer.at(-1) !== 0x0a) {
    problems.push('does not end with LF');
  }
  return problems;
}

export function findCaseInsensitivePathCollisions(filePaths) {
  const byFoldedPath = new Map();
  for (const filePath of filePaths) {
    const normalized = filePath.replaceAll('\\', '/');
    const folded = normalized.toLowerCase();
    const group = byFoldedPath.get(folded) ?? [];
    group.push(normalized);
    byFoldedPath.set(folded, group);
  }
  return [...byFoldedPath.values()].filter((group) => group.length > 1);
}

function listRepositoryPaths() {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`Failed to start git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || 'git ls-files failed').trim());
  }
  return result.stdout.split('\0').filter(Boolean);
}

function main() {
  const repositoryPaths = listRepositoryPaths();
  const errors = [];

  for (const collision of findCaseInsensitivePathCollisions(repositoryPaths)) {
    errors.push(`case-insensitive path collision: ${collision.join(' <=> ')}`);
  }

  const textPaths = repositoryPaths.filter(isTrackedTextPath);
  for (const filePath of textPaths) {
    if (!fs.existsSync(filePath)) continue;
    const buffer = fs.readFileSync(filePath);
    for (const problem of inspectTextBuffer(buffer)) {
      errors.push(`${filePath}: ${problem}`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`Text file check failed (${errors.length}):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Text file check passed (${textPaths.length} repository text files).\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) main();
