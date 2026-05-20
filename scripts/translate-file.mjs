#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { run as defaultRunTranslateFile } from "./translate-file-runner.mjs";

const OPTION_NAMES = new Set([
  "db",
  "db-path",
  "project-id",
  "input",
  "output",
  "target-scope",
  "checkpoint",
  "events",
  "artifacts",
  "resume",
  "max-attempts",
  "snapshot",
  "snapshot-every-units",
  "snapshot-every-seconds",
  "progress-stdout",
]);
const BOOLEAN_OPTIONS = new Set(["resume", "progress-stdout"]);

function usage() {
  console.log(`Usage:
  node scripts/translate-file.mjs --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>                    SQLite DB path.
  --project-id <id>              Project id that owns the file and mounted TM/TB resources.
  --input <path>                 Spreadsheet path to translate.
  --output <path>                Output spreadsheet path.
  --target-scope <scope>         blank-only or overwrite-non-confirmed. Default: engine default.
  --checkpoint <path>            Checkpoint JSONL path. Default: inferred from output path.
  --events <path>                Event JSONL path. Default: inferred from output path.
  --artifacts <path>             Enable diagnostic prompt artifact JSONL at this path.
  --resume                       Resume from an existing checkpoint.
  --max-attempts <n>             Positive integer retry attempt limit.
  --snapshot <path>              Snapshot spreadsheet path. Default: inferred from output path.
  --snapshot-every-units <n>     Positive integer snapshot cadence by completed units.
  --snapshot-every-seconds <n>   Positive integer snapshot cadence by elapsed seconds.
  --progress-stdout              Emit live NDJSON job events to stdout.
  -h, --help                     Show this help.

Examples:
  npm run translate:file -- --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx
  npm run translate:file -- --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx --target-scope overwrite-non-confirmed --resume`);
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

  if (BOOLEAN_OPTIONS.has(name)) {
    if (value !== undefined) {
      throw new Error(`${flag} does not take a value.`);
    }
    config[name === "resume" ? "resume" : "progressStdout"] = true;
    return;
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
  if (name === "target-scope") {
    config.targetScope = optionValue;
    return;
  }
  if (name === "checkpoint") {
    config.checkpointPath = path.resolve(optionValue);
    return;
  }
  if (name === "events") {
    config.eventsPath = path.resolve(optionValue);
    return;
  }
  if (name === "artifacts") {
    config.artifactsPath = path.resolve(optionValue);
    return;
  }
  if (name === "max-attempts") {
    config.maxAttempts = optionValue;
    return;
  }
  if (name === "snapshot") {
    config.snapshotPath = path.resolve(optionValue);
    return;
  }
  if (name === "snapshot-every-units") {
    config.snapshotEveryUnits = optionValue;
    return;
  }
  if (name === "snapshot-every-seconds") {
    config.snapshotEverySeconds = optionValue;
    return;
  }
}

function parseArgs(argv) {
  const config = {
    dbPath: "",
    projectId: "",
    inputPath: "",
    outputPath: "",
    targetScope: "",
    checkpointPath: "",
    eventsPath: "",
    artifactsPath: "",
    resume: false,
    maxAttempts: "",
    snapshotPath: "",
    snapshotEveryUnits: "",
    snapshotEverySeconds: "",
    progressStdout: false,
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
    if (BOOLEAN_OPTIONS.has(name)) {
      assignOption(config, name);
      continue;
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
  if (
    config.targetScope &&
    config.targetScope !== "blank-only" &&
    config.targetScope !== "overwrite-non-confirmed"
  ) {
    throw new Error(
      "--target-scope must be blank-only or overwrite-non-confirmed.",
    );
  }
  if (config.maxAttempts && !isPositiveInteger(config.maxAttempts)) {
    throw new Error("--max-attempts must be a positive integer.");
  }
  if (
    config.snapshotEveryUnits &&
    !isPositiveInteger(config.snapshotEveryUnits)
  ) {
    throw new Error("--snapshot-every-units must be a positive integer.");
  }
  if (
    config.snapshotEverySeconds &&
    !isPositiveInteger(config.snapshotEverySeconds)
  ) {
    throw new Error("--snapshot-every-seconds must be a positive integer.");
  }

  return config;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

async function loadRunner() {
  if (!process.env.TRANSLATE_FILE_RUNNER) {
    return defaultRunTranslateFile;
  }
  const runnerUrl = pathToFileURL(path.resolve(process.env.TRANSLATE_FILE_RUNNER));
  const { run } = await import(runnerUrl.href);
  return run;
}

try {
  const config = parseArgs(process.argv.slice(2));
  const runTranslateFile = await loadRunner();
  await runTranslateFile({
    dbPath: config.dbPath,
    projectId: Number(config.projectId),
    inputPath: config.inputPath,
    outputPath: config.outputPath,
    targetScope: config.targetScope || undefined,
    checkpointPath: config.checkpointPath || undefined,
    eventsPath: config.eventsPath || undefined,
    artifactsPath: config.artifactsPath || undefined,
    resume: config.resume,
    maxAttempts: config.maxAttempts ? Number(config.maxAttempts) : undefined,
    snapshotPath: config.snapshotPath || undefined,
    snapshotEveryUnits: config.snapshotEveryUnits
      ? Number(config.snapshotEveryUnits)
      : undefined,
    snapshotEverySeconds: config.snapshotEverySeconds
      ? Number(config.snapshotEverySeconds)
      : undefined,
    progressStdout: config.progressStdout,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
