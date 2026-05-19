#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_NAME = "localization-engine-file-env-run";
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts";

function usage() {
  console.log(`Usage:
  node scripts/translate-file.mjs --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>                    SQLite DB path.
  --project-id <id>              Project id that owns the file and mounted TM/TB resources.
  --input <path>                 Spreadsheet path to translate.
  --output <path>                Output spreadsheet path.
  --target-scope <scope>         blank-only or overwrite-non-confirmed. Default: engine default.
  -h, --help                     Show this help.

Examples:
  npm run translate:file -- --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx
  npm run translate:file -- --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx --target-scope overwrite-non-confirmed`);
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
    dbPath: "",
    projectId: "",
    inputPath: "",
    outputPath: "",
    targetScope: "",
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
    if (arg === "--input") {
      config.inputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      config.inputPath = path.resolve(arg.slice("--input=".length));
      continue;
    }
    if (arg === "--output") {
      config.outputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      config.outputPath = path.resolve(arg.slice("--output=".length));
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

    throw new Error(`Unknown argument: ${arg}`);
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
      env: {
        ...process.env,
        LOCALIZATION_ENGINE_FILE_DYNAMIC: "1",
        LOCALIZATION_ENGINE_DB_PATH: config.dbPath,
        LOCALIZATION_ENGINE_PROJECT_ID: config.projectId,
        LOCALIZATION_ENGINE_INPUT_PATH: config.inputPath,
        LOCALIZATION_ENGINE_OUTPUT_PATH: config.outputPath,
        LOCALIZATION_ENGINE_TARGET_SCOPE: config.targetScope,
      },
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
