#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_NAME = "localization-engine-file-env-run";
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts";
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
  --artifacts <path>             Artifact JSONL path. Default: inferred from output path.
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

function spawnCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function buildRunnerEnv(config) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("LOCALIZATION_ENGINE_")) {
      delete env[key];
    }
  }

  Object.assign(env, {
    LOCALIZATION_ENGINE_FILE_DYNAMIC: "1",
    LOCALIZATION_ENGINE_DB_PATH: config.dbPath,
    LOCALIZATION_ENGINE_PROJECT_ID: config.projectId,
    LOCALIZATION_ENGINE_INPUT_PATH: config.inputPath,
    LOCALIZATION_ENGINE_OUTPUT_PATH: config.outputPath,
    LOCALIZATION_ENGINE_JOB_ENABLED: "1",
  });
  if (config.targetScope) {
    env.LOCALIZATION_ENGINE_TARGET_SCOPE = config.targetScope;
  }
  if (config.checkpointPath) {
    env.LOCALIZATION_ENGINE_CHECKPOINT_PATH = config.checkpointPath;
  }
  if (config.eventsPath) {
    env.LOCALIZATION_ENGINE_EVENTS_PATH = config.eventsPath;
  }
  if (config.artifactsPath) {
    env.LOCALIZATION_ENGINE_ARTIFACTS_PATH = config.artifactsPath;
  }
  if (config.resume) {
    env.LOCALIZATION_ENGINE_RESUME = "1";
  }
  if (config.maxAttempts) {
    env.LOCALIZATION_ENGINE_MAX_ATTEMPTS = config.maxAttempts;
  }
  if (config.snapshotPath) {
    env.LOCALIZATION_ENGINE_SNAPSHOT_PATH = config.snapshotPath;
  }
  if (config.snapshotEveryUnits) {
    env.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS = config.snapshotEveryUnits;
  }
  if (config.snapshotEverySeconds) {
    env.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS =
      config.snapshotEverySeconds;
  }
  if (config.progressStdout) {
    env.LOCALIZATION_ENGINE_PROGRESS_STDOUT = "1";
  }

  return env;
}

function runTranslation(config) {
  const vitestCmd = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!fs.existsSync(vitestCmd)) {
    throw new Error(`Vitest binary not found: ${vitestCmd}`);
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
      env: buildRunnerEnv(config),
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw new Error(`Failed to start ${vitestCmd}: ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}

try {
  runTranslation(parseArgs(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
