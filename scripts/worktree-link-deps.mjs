#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.log(`Usage:
  node scripts/worktree-link-deps.mjs [--source <path>] [--force]

Options:
  --source <path>  Explicitly set the source repo root that already has node_modules.
  --force          Replace an existing non-symlink node_modules in current worktree.
  -h, --help       Show this help.`);
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`Failed to start git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function normalizeForCompare(input) {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function sameRealPath(a, b) {
  try {
    const [ra, rb] = await Promise.all([fs.realpath(a), fs.realpath(b)]);
    return normalizeForCompare(ra) === normalizeForCompare(rb);
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  let source = '';
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --source');
      }
      source = value;
      i += 1;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { source, force };
}

function findMainWorktreeRoot(porcelainOutput) {
  const lines = porcelainOutput.split(/\r?\n/);
  let currentWorktree = '';
  let mainWorktree = '';

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentWorktree = line.slice('worktree '.length);
      continue;
    }
    if (line === 'branch refs/heads/main') {
      mainWorktree = currentWorktree;
    }
  }

  return mainWorktree;
}

async function createNodeModulesLink(sourceNodeModules, targetNodeModules) {
  if (process.platform !== 'win32') {
    await fs.symlink(sourceNodeModules, targetNodeModules, 'dir');
    return 'symlink';
  }

  try {
    await fs.symlink(sourceNodeModules, targetNodeModules, 'dir');
    return 'symlink';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[worktree:deps:link] Directory symlink failed on Windows, fallback to junction: ${message}`,
    );
    await fs.symlink(sourceNodeModules, targetNodeModules, 'junction');
    return 'junction';
  }
}

async function main() {
  const { source: sourceArg, force } = parseArgs(process.argv.slice(2));

  const currentRoot = runGit(['rev-parse', '--show-toplevel']);
  if (!currentRoot) {
    throw new Error('Not inside a git repository.');
  }

  let sourceRoot = sourceArg;
  if (!sourceRoot) {
    const worktreeOutput = runGit(['worktree', 'list', '--porcelain']);
    sourceRoot = findMainWorktreeRoot(worktreeOutput) || currentRoot;
  }

  sourceRoot = path.resolve(sourceRoot);
  const resolvedCurrentRoot = path.resolve(currentRoot);
  const sourceNodeModules = path.join(sourceRoot, 'node_modules');
  const targetNodeModules = path.join(resolvedCurrentRoot, 'node_modules');

  if (normalizeForCompare(resolvedCurrentRoot) === normalizeForCompare(sourceRoot)) {
    console.log(`Current worktree is the source worktree (${sourceRoot}). Nothing to link.`);
    return;
  }

  const sourceStats = await fs.stat(sourceNodeModules).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new Error(
      `Source node_modules not found at: ${sourceNodeModules}\nInstall dependencies in source first (e.g. npm ci).`,
    );
  }

  const targetStats = await fs.lstat(targetNodeModules).catch(() => null);
  if (targetStats) {
    if (targetStats.isSymbolicLink()) {
      if (await sameRealPath(targetNodeModules, sourceNodeModules)) {
        console.log(`node_modules already linked to source: ${sourceNodeModules}`);
        return;
      }
      await fs.rm(targetNodeModules, { recursive: true, force: true });
    } else {
      if (!force) {
        throw new Error(
          'Current worktree already has a physical node_modules directory.\nUse --force to replace it with a link.',
        );
      }
      await fs.rm(targetNodeModules, { recursive: true, force: true });
    }
  }

  const linkType = await createNodeModulesLink(sourceNodeModules, targetNodeModules);
  console.log('Linked:');
  console.log(`  ${targetNodeModules} -> ${sourceNodeModules}`);
  console.log(`  link type: ${linkType}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
