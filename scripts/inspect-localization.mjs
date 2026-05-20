#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { run as defaultRunInspectLocalization } from "./inspect-localization-runner.mjs";

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

async function loadRunner() {
  if (!process.env.INSPECT_LOCALIZATION_RUNNER) {
    return defaultRunInspectLocalization;
  }
  const runnerUrl = pathToFileURL(
    path.resolve(process.env.INSPECT_LOCALIZATION_RUNNER),
  );
  const { run } = await import(runnerUrl.href);
  return run;
}

try {
  const config = parseArgs(process.argv.slice(2));
  const runInspectLocalization = await loadRunner();
  await runInspectLocalization({
    dbPath: config.dbPath,
    projectId: Number(config.projectId),
    inputPath: config.inputPath,
    outputPath: config.outputPath,
    jsonOutputPath: config.jsonOutputPath || undefined,
    unitLimit: config.unitLimit ? Number(config.unitLimit) : undefined,
    maxCellChars: config.maxCellChars ? Number(config.maxCellChars) : undefined,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
