#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TRACE_TEST_NAME = 'tb-flow-env-trace';
const TRACE_TEST_PATH = 'apps/desktop/src/main/services/TBMatchFlow.test.ts';

function usage() {
  console.log(`Usage:
  node scripts/tb-match-flow-trace.mjs --project-id <id> (--source <text>|--segment-id <id>) [options]

Options:
  --db <path>                    SQLite DB path. Default: .cat_data/cat_v1.db
  --project-id <id>              Project id whose mounted TBs should be traced.
  --source <text>                Source text to trace as a synthetic active segment.
  --segment-id <id>              Existing segment id to trace with its real tokens.
  --focus-src-term <term[,term]> Comma-separated source terms to highlight in trace summaries.
  --focus-tgt-term <term[,term]> Comma-separated target terms to highlight in trace summaries.
  -h, --help                     Show this help.

Examples:
  npm run trace:tb-flow -- --project-id 3 --source "Example term in context"
  npm run trace:tb-flow -- --project-id 3 --segment-id seg-123 --focus-src-term "Example term"
  npm run trace:tb-flow -- --project-id 3 --source "Example term" --focus-tgt-term "Example target"`);
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
    source: '',
    segmentId: '',
    focusSrcTerm: '',
    focusTgtTerm: '',
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
    if (arg === '--source') {
      config.source = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--source=')) {
      config.source = arg.slice('--source='.length);
      continue;
    }
    if (arg === '--segment-id') {
      config.segmentId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--segment-id=')) {
      config.segmentId = arg.slice('--segment-id='.length);
      continue;
    }
    if (arg === '--focus-src-term') {
      config.focusSrcTerm = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--focus-src-term=')) {
      config.focusSrcTerm = arg.slice('--focus-src-term='.length);
      continue;
    }
    if (arg === '--focus-tgt-term') {
      config.focusTgtTerm = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--focus-tgt-term=')) {
      config.focusTgtTerm = arg.slice('--focus-tgt-term='.length);
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
  if (!config.source && !config.segmentId) {
    throw new Error('Provide --source or --segment-id.');
  }
  if (config.source && config.segmentId) {
    throw new Error('Provide only one of --source or --segment-id.');
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
    TB_MATCH_FLOW_DYNAMIC: '1',
    TB_MATCH_FLOW_TRACE: '1',
    TB_MATCH_FLOW_DB_PATH: config.dbPath,
    TB_MATCH_FLOW_PROJECT_ID: config.projectId,
    TB_MATCH_FLOW_SOURCE: config.source,
    TB_MATCH_FLOW_SEGMENT_ID: config.segmentId,
    TB_MATCH_FLOW_FOCUS_SRC_TERM: config.focusSrcTerm,
    TB_MATCH_FLOW_FOCUS_TGT_TERM: config.focusTgtTerm,
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
