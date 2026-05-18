#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TRACE_TEST_NAME = 'ai-file-flow-env-trace';
const TRACE_TEST_PATH = 'apps/desktop/src/main/headless/aiFileFlowRunner.test.ts';

function usage() {
  console.log(`Usage:
  node scripts/ai-file-flow-trace.mjs --project-id <id> --file-id <id> [options]

Options:
  --db <path>                    SQLite DB path. Default: .cat_data/cat_v1.db
  --project-id <id>              Project id that owns the file and mounted TM/TB resources.
  --file-id <id>                 File id to translate through the headless AI flow.
  --model <provider-id>          Optional AI provider id override.
  --mode <mode>                  standard or dialogue. Default: standard.
  --target-scope <scope>         blank-only or overwrite-non-confirmed. Default: blank-only.
  --preview-limit <n>            Number of leading segments to preview for TM/TB references. Default: 3.
  -h, --help                     Show this help.

Examples:
  npm run trace:ai-file -- --project-id 1 --file-id 23
  npm run trace:ai-file -- --project-id 1 --file-id 23 --target-scope overwrite-non-confirmed
  npm run trace:ai-file -- --db .cat_data/cat_v1.db --project-id 1 --file-id 23 --preview-limit 5`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    dbPath: path.resolve(process.cwd(), '.cat_data/cat_v1.db'),
    projectId: '',
    fileId: '',
    model: '',
    mode: 'standard',
    targetScope: '',
    previewLimit: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--db' || arg === '--db-path') {
      config.dbPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      config.dbPath = path.resolve(arg.slice('--db='.length));
      continue;
    }
    if (arg === '--project-id') {
      config.projectId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      config.projectId = arg.slice('--project-id='.length);
      continue;
    }
    if (arg === '--file-id') {
      config.fileId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-id=')) {
      config.fileId = arg.slice('--file-id='.length);
      continue;
    }
    if (arg === '--model') {
      config.model = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      config.model = arg.slice('--model='.length);
      continue;
    }
    if (arg === '--mode') {
      config.mode = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      config.mode = arg.slice('--mode='.length);
      continue;
    }
    if (arg === '--target-scope') {
      config.targetScope = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--target-scope=')) {
      config.targetScope = arg.slice('--target-scope='.length);
      continue;
    }
    if (arg === '--preview-limit') {
      config.previewLimit = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--preview-limit=')) {
      config.previewLimit = arg.slice('--preview-limit='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.projectId) {
    throw new Error('Missing --project-id.');
  }
  if (!Number.isInteger(Number(config.projectId)) || Number(config.projectId) <= 0) {
    throw new Error('--project-id must be a positive integer.');
  }
  if (!config.fileId) {
    throw new Error('Missing --file-id.');
  }
  if (!Number.isInteger(Number(config.fileId)) || Number(config.fileId) <= 0) {
    throw new Error('--file-id must be a positive integer.');
  }
  if (config.mode !== 'standard' && config.mode !== 'dialogue') {
    throw new Error('--mode must be standard or dialogue.');
  }
  if (
    config.targetScope &&
    config.targetScope !== 'blank-only' &&
    config.targetScope !== 'overwrite-non-confirmed'
  ) {
    throw new Error('--target-scope must be blank-only or overwrite-non-confirmed.');
  }
  if (
    config.previewLimit &&
    (!Number.isInteger(Number(config.previewLimit)) || Number(config.previewLimit) < 0)
  ) {
    throw new Error('--preview-limit must be a non-negative integer.');
  }
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`Database not found: ${config.dbPath}`);
  }

  return config;
}

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function runTrace(config) {
  const vitestCmd = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
  );
  if (!fs.existsSync(vitestCmd)) {
    throw new Error(`Vitest binary not found: ${vitestCmd}`);
  }

  const env = {
    ...process.env,
    AI_FILE_FLOW_DYNAMIC: '1',
    AI_FILE_FLOW_TRACE: '1',
    AI_FILE_FLOW_DB_PATH: config.dbPath,
    AI_FILE_FLOW_PROJECT_ID: config.projectId,
    AI_FILE_FLOW_FILE_ID: config.fileId,
    AI_FILE_FLOW_MODEL: config.model,
    AI_FILE_FLOW_MODE: config.mode,
    AI_FILE_FLOW_TARGET_SCOPE: config.targetScope,
    AI_FILE_FLOW_PREVIEW_LIMIT: config.previewLimit,
  };
  const result = spawnCommandSync(
    vitestCmd,
    ['run', TRACE_TEST_PATH, '-t', TRACE_TEST_NAME, '--reporter=verbose'],
    {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw new Error(`Failed to start ${vitestCmd}: ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}

try {
  runTrace(parseArgs(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
