#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_NAME = "localization-inspect-env-run";
const TEST_PATH =
  "packages/localization/src/LocalizationInspector.cli.test.ts";
const OPTION_NAMES = new Set([
  "db",
  "db-path",
  "project-id",
  "input",
  "output",
  "json-output",
  "unit-limit",
  "max-cell-chars",
]);

function usage() {
  console.log(`Usage:
  node scripts/inspect-localization.mjs --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path.
  --project-id <id>                Project id that owns the file and mounted TM/TB resources.
  --input <path>                   Spreadsheet path to inspect.
  --output <path>                  Output inspection spreadsheet path.
  --json-output <path>             Optional JSON artifact output path.
  --unit-limit <n>                 Optional maximum number of source units to inspect.
  --max-cell-chars <n>             Optional max characters per generated spreadsheet cell.
  -h, --help                       Show this help.

Examples:
  npm run inspect:localization -- --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output inspect.xlsx
  npm run inspect:localization -- --db-path .cat_data/cat_v1.db --project-id=1 --input=mt.xlsx --output=inspect.xlsx --json-output=inspect.json`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function requireOptionValue(flag, value) {
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function assignOption(config, name, value, flag = `--${name}`) {
  if (!OPTION_NAMES.has(name)) {
    throw new Error(`Unknown argument: --${name}`);
  }

  const optionValue = requireOptionValue(flag, value);

  if (name === "db" || name === "db-path") {
    config.dbPath = path.resolve(optionValue);
    return;
  }
  if (name === "project-id") {
    config.projectId = optionValue;
    return;
  }
  if (name === "input") {
    config.inputPath = path.resolve(optionValue);
    return;
  }
  if (name === "output") {
    config.outputPath = path.resolve(optionValue);
    return;
  }
  if (name === "json-output") {
    config.jsonOutputPath = path.resolve(optionValue);
    return;
  }
  if (name === "unit-limit") {
    config.unitLimit = optionValue;
    return;
  }
  if (name === "max-cell-chars") {
    config.maxCellChars = optionValue;
    return;
  }
}

function parseArgs(argv) {
  const config = {
    dbPath: "",
    projectId: "",
    inputPath: "",
    outputPath: "",
    jsonOutputPath: "",
    unitLimit: "",
    maxCellChars: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex !== -1) {
      assignOption(
        config,
        arg.slice(2, equalsIndex),
        arg.slice(equalsIndex + 1),
        arg.slice(0, equalsIndex),
      );
      continue;
    }

    const name = arg.slice(2);
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`Unknown argument: --${name}`);
    }
    assignOption(config, name, readValue(argv, index, arg), arg);
    index += 1;
  }

  if (!config.dbPath) {
    throw new Error("Missing --db.");
  }
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`Database not found: ${config.dbPath}`);
  }
  if (!config.projectId) {
    throw new Error("Missing --project-id.");
  }
  if (!isPositiveInteger(config.projectId)) {
    throw new Error("--project-id must be a positive integer.");
  }
  if (!config.inputPath) {
    throw new Error("Missing --input.");
  }
  if (!fs.existsSync(config.inputPath)) {
    throw new Error(`Input file not found: ${config.inputPath}`);
  }
  if (!config.outputPath) {
    throw new Error("Missing --output.");
  }
  if (config.unitLimit && !isPositiveInteger(config.unitLimit)) {
    throw new Error("--unit-limit must be a positive integer.");
  }
  if (config.maxCellChars && !isPositiveInteger(config.maxCellChars)) {
    throw new Error("--max-cell-chars must be a positive integer.");
  }

  return config;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function runInspection(config) {
  const vitestCmd = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!fs.existsSync(vitestCmd)) {
    throw new Error(`Vitest binary not found: ${vitestCmd}`);
  }

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("LOCALIZATION_INSPECT_")) {
      delete env[key];
    }
  }
  Object.assign(env, {
    LOCALIZATION_INSPECT_DYNAMIC: "1",
    LOCALIZATION_INSPECT_DB_PATH: config.dbPath,
    LOCALIZATION_INSPECT_PROJECT_ID: config.projectId,
    LOCALIZATION_INSPECT_INPUT_PATH: config.inputPath,
    LOCALIZATION_INSPECT_OUTPUT_PATH: config.outputPath,
  });
  if (config.jsonOutputPath) {
    env.LOCALIZATION_INSPECT_JSON_OUTPUT_PATH = config.jsonOutputPath;
  }
  if (config.unitLimit) {
    env.LOCALIZATION_INSPECT_UNIT_LIMIT = config.unitLimit;
  }
  if (config.maxCellChars) {
    env.LOCALIZATION_INSPECT_MAX_CELL_CHARS = config.maxCellChars;
  }

  const result = spawnCommandSync(
    vitestCmd,
    [
      "run",
      TEST_PATH,
      "-t",
      TEST_NAME,
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
  runInspection(parseArgs(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
