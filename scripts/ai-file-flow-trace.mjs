#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TRACE_TEST_NAME = "ai-file-flow-env-trace";
const TRACE_TEST_PATH =
  "apps/desktop/src/main/headless/aiFileFlowRunner.test.ts";

function usage() {
  console.log(`Usage:
  node scripts/ai-file-flow-trace.mjs (--project-id <id> | --project-name <name>) (--file-id <id> | --file <path>) [options]

Options:
  --db <path>                    SQLite DB path. Default: .cat_data/cat_v1.db
  --project-id <id>              Project id that owns the file and mounted TM/TB resources.
  --project-name <name>          Exact project name to resolve when project id is unknown.
  --file-id <id>                 Existing file id to translate through the headless AI flow.
  --file <path>                  Spreadsheet path to import into the project before translation.
  --source-col <n>               Optional zero-based source column override for --file.
  --target-col <n>               Optional zero-based target column override for --file.
  --context-col <n>              Optional zero-based context column for --file.
  --no-header                    Import all rows; by default --file auto-detects source/target headers.
  --model <provider-id>          Optional AI provider id override.
  --mode <mode>                  standard or dialogue. Default: standard.
  --target-scope <scope>         blank-only or overwrite-non-confirmed. Default: blank-only.
  --preview-limit <n>            Number of leading segments to preview for TM/TB references. Default: 3.
  -h, --help                     Show this help.

Examples:
  npm run trace:ai-file -- --project-id 1 --file-id 23
  npm run trace:ai-file -- --project-name "Nikki(zh-fr)" --file "C:\\path\\mt.xlsx"
  npm run trace:ai-file -- --project-id 1 --file-id 23 --target-scope overwrite-non-confirmed
  npm run trace:ai-file -- --db .cat_data/cat_v1.db --project-id 1 --file-id 23 --preview-limit 5`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    dbPath: path.resolve(process.cwd(), ".cat_data/cat_v1.db"),
    projectId: "",
    projectName: "",
    fileId: "",
    filePath: "",
    hasHeader: true,
    sourceCol: "",
    targetCol: "",
    contextCol: "",
    hasManualImportOptions: false,
    model: "",
    mode: "standard",
    targetScope: "",
    previewLimit: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--db" || arg === "--db-path") {
      config.dbPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      config.dbPath = path.resolve(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--project-id") {
      config.projectId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      config.projectId = arg.slice("--project-id=".length);
      continue;
    }
    if (arg === "--project-name") {
      config.projectName = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-name=")) {
      config.projectName = arg.slice("--project-name=".length);
      continue;
    }
    if (arg === "--file-id") {
      config.fileId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--file-id=")) {
      config.fileId = arg.slice("--file-id=".length);
      continue;
    }
    if (arg === "--file") {
      config.filePath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      config.filePath = path.resolve(arg.slice("--file=".length));
      continue;
    }
    if (arg === "--source-col") {
      config.sourceCol = readValue(argv, index, arg);
      config.hasManualImportOptions = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-col=")) {
      config.sourceCol = arg.slice("--source-col=".length);
      config.hasManualImportOptions = true;
      continue;
    }
    if (arg === "--target-col") {
      config.targetCol = readValue(argv, index, arg);
      config.hasManualImportOptions = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-col=")) {
      config.targetCol = arg.slice("--target-col=".length);
      config.hasManualImportOptions = true;
      continue;
    }
    if (arg === "--context-col") {
      config.contextCol = readValue(argv, index, arg);
      config.hasManualImportOptions = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--context-col=")) {
      config.contextCol = arg.slice("--context-col=".length);
      config.hasManualImportOptions = true;
      continue;
    }
    if (arg === "--no-header") {
      config.hasHeader = false;
      config.hasManualImportOptions = true;
      continue;
    }
    if (arg === "--has-header") {
      config.hasHeader = true;
      config.hasManualImportOptions = true;
      continue;
    }
    if (arg === "--model") {
      config.model = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      config.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--mode") {
      config.mode = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      config.mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--target-scope") {
      config.targetScope = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-scope=")) {
      config.targetScope = arg.slice("--target-scope=".length);
      continue;
    }
    if (arg === "--preview-limit") {
      config.previewLimit = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--preview-limit=")) {
      config.previewLimit = arg.slice("--preview-limit=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.projectId && !config.projectName) {
    throw new Error("Missing --project-id or --project-name.");
  }
  if (config.projectId && !isPositiveInteger(config.projectId)) {
    throw new Error("--project-id must be a positive integer.");
  }
  if (!config.fileId && !config.filePath) {
    throw new Error("Missing --file-id or --file.");
  }
  if (config.fileId && !isPositiveInteger(config.fileId)) {
    throw new Error("--file-id must be a positive integer.");
  }
  if (config.filePath && !fs.existsSync(config.filePath)) {
    throw new Error(`File not found: ${config.filePath}`);
  }
  if (config.hasManualImportOptions) {
    validateNonNegativeInteger(config.sourceCol || "0", "--source-col");
    validateNonNegativeInteger(config.targetCol || "1", "--target-col");
    if (config.contextCol) {
      validateNonNegativeInteger(config.contextCol, "--context-col");
    }
  }
  if (config.mode !== "standard" && config.mode !== "dialogue") {
    throw new Error("--mode must be standard or dialogue.");
  }
  if (
    config.targetScope &&
    config.targetScope !== "blank-only" &&
    config.targetScope !== "overwrite-non-confirmed"
  ) {
    throw new Error(
      "--target-scope must be blank-only or overwrite-non-confirmed.",
    );
  }
  if (
    config.previewLimit &&
    (!Number.isInteger(Number(config.previewLimit)) ||
      Number(config.previewLimit) < 0)
  ) {
    throw new Error("--preview-limit must be a non-negative integer.");
  }
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`Database not found: ${config.dbPath}`);
  }

  return config;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function validateNonNegativeInteger(value, flag) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
}

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function runTrace(config) {
  const vitestCmd = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!fs.existsSync(vitestCmd)) {
    throw new Error(`Vitest binary not found: ${vitestCmd}`);
  }

  const env = {
    ...process.env,
    AI_FILE_FLOW_DYNAMIC: "1",
    AI_FILE_FLOW_TRACE: "1",
    AI_FILE_FLOW_DB_PATH: config.dbPath,
    AI_FILE_FLOW_PROJECT_ID: config.projectId,
    AI_FILE_FLOW_PROJECT_NAME: config.projectName,
    AI_FILE_FLOW_FILE_ID: config.fileId,
    AI_FILE_FLOW_FILE_PATH: config.filePath,
    AI_FILE_FLOW_MODEL: config.model,
    AI_FILE_FLOW_MODE: config.mode,
    AI_FILE_FLOW_TARGET_SCOPE: config.targetScope,
    AI_FILE_FLOW_PREVIEW_LIMIT: config.previewLimit,
  };
  if (config.hasManualImportOptions) {
    env.AI_FILE_FLOW_HAS_HEADER = config.hasHeader ? "1" : "0";
    env.AI_FILE_FLOW_SOURCE_COL = config.sourceCol || "0";
    env.AI_FILE_FLOW_TARGET_COL = config.targetCol || "1";
    env.AI_FILE_FLOW_CONTEXT_COL = config.contextCol;
  }
  const result = spawnCommandSync(
    vitestCmd,
    [
      "run",
      TRACE_TEST_PATH,
      "-t",
      TRACE_TEST_NAME,
      "--reporter=verbose",
      "--testTimeout=3600000",
    ],
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
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
