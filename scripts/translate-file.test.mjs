import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts", "translate-file.mjs");

function runScript(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: options.env,
    encoding: "utf8",
  });
}

function withTempFixture(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cat-translate-file-"));
  try {
    const dbPath = path.join(tempRoot, "cat.db");
    const inputPath = path.join(tempRoot, "input.xlsx");
    const outputPath = path.join(tempRoot, "translated.xlsx");
    fs.writeFileSync(dbPath, "");
    fs.writeFileSync(inputPath, "");

    return callback({
      tempRoot,
      dbPath,
      inputPath,
      outputPath,
      baseArgs: [
        "--db",
        dbPath,
        "--project-id",
        "1",
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function installFakeVitest(tempRoot, reportPath) {
  const binDir = path.join(tempRoot, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });

  const fakeVitestScript = path.join(binDir, "vitest-check.mjs");
  fs.writeFileSync(
    fakeVitestScript,
    `import fs from "node:fs";

const names = [
  "LOCALIZATION_ENGINE_FILE_DYNAMIC",
  "LOCALIZATION_ENGINE_DB_PATH",
  "LOCALIZATION_ENGINE_PROJECT_ID",
  "LOCALIZATION_ENGINE_INPUT_PATH",
  "LOCALIZATION_ENGINE_OUTPUT_PATH",
  "LOCALIZATION_ENGINE_TARGET_SCOPE",
  "LOCALIZATION_ENGINE_JOB_ENABLED",
  "LOCALIZATION_ENGINE_CHECKPOINT_PATH",
  "LOCALIZATION_ENGINE_EVENTS_PATH",
  "LOCALIZATION_ENGINE_ARTIFACTS_PATH",
  "LOCALIZATION_ENGINE_RESUME",
  "LOCALIZATION_ENGINE_MAX_ATTEMPTS",
  "LOCALIZATION_ENGINE_SNAPSHOT_PATH",
  "LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS",
  "LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS",
  "LOCALIZATION_ENGINE_PROGRESS_STDOUT",
];
const report = Object.fromEntries(
  names.map((name) => [
    name,
    {
      present: Object.prototype.hasOwnProperty.call(process.env, name),
      value: process.env[name] ?? null,
    },
  ]),
);
fs.writeFileSync(process.env.ENV_REPORT_PATH, JSON.stringify(report), "utf8");
`,
  );

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, "vitest.cmd"),
      '@echo off\r\n"%NODE_EXE%" "%~dp0\\vitest-check.mjs"\r\n',
    );
  } else {
    const vitestPath = path.join(binDir, "vitest");
    fs.writeFileSync(
      vitestPath,
      '#!/bin/sh\n"$NODE_EXE" "$(dirname "$0")/vitest-check.mjs"\n',
    );
    fs.chmodSync(vitestPath, 0o755);
  }
}

test("translate file script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = runScript(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /translate-file\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--input <path>/);
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--target-scope <scope>/);
  assert.match(result.stdout, /--checkpoint <path>/);
  assert.match(result.stdout, /--events <path>/);
  assert.match(result.stdout, /--artifacts <path>/);
  assert.match(result.stdout, /--resume/);
  assert.match(result.stdout, /--max-attempts <n>/);
  assert.match(result.stdout, /--snapshot <path>/);
  assert.match(result.stdout, /--snapshot-every-units <n>/);
  assert.match(result.stdout, /--snapshot-every-seconds <n>/);
  assert.match(result.stdout, /--progress-stdout/);
});

test("translate file script validates invalid numeric options", () => {
  withTempFixture(({ baseArgs }) => {
    const cases = [
      {
        args: [...baseArgs, "--max-attempts", "0"],
        pattern: /--max-attempts must be a positive integer\./,
      },
      {
        args: [...baseArgs, "--snapshot-every-units", "nope"],
        pattern: /--snapshot-every-units must be a positive integer\./,
      },
      {
        args: [...baseArgs, "--snapshot-every-seconds=-1"],
        pattern: /--snapshot-every-seconds must be a positive integer\./,
      },
    ];

    for (const { args, pattern } of cases) {
      const result = runScript(args);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.match(result.stderr, pattern, args.join(" "));
    }
  });
});

test("translate file script rejects unknown args", () => {
  const result = runScript(["--wat"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --wat/);
});

test("translate file script passes explicit job paths and options to runner env", () => {
  withTempFixture(({ tempRoot, dbPath, inputPath, outputPath }) => {
    const reportPath = path.join(tempRoot, "env-report.json");
    installFakeVitest(tempRoot, reportPath);

    const checkpointPath = path.join(tempRoot, "custom.checkpoint.jsonl");
    const eventsPath = path.join(tempRoot, "custom.events.jsonl");
    const artifactsPath = path.join(tempRoot, "custom.artifacts.jsonl");
    const snapshotPath = path.join(tempRoot, "custom.snapshot.xlsx");
    const env = {
      ...process.env,
      NODE_EXE: process.execPath,
      ENV_REPORT_PATH: reportPath,
    };

    const result = runScript(
      [
        `--db=${dbPath}`,
        "--project-id=1",
        `--input=${inputPath}`,
        `--output=${outputPath}`,
        "--target-scope=blank-only",
        "--checkpoint",
        checkpointPath,
        `--events=${eventsPath}`,
        "--artifacts",
        artifactsPath,
        "--max-attempts=3",
        "--snapshot",
        snapshotPath,
        "--snapshot-every-units=5",
        "--snapshot-every-seconds",
        "7",
        "--progress-stdout",
      ],
      { cwd: tempRoot, env },
    );

    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.LOCALIZATION_ENGINE_FILE_DYNAMIC.value, "1");
    assert.equal(report.LOCALIZATION_ENGINE_DB_PATH.value, dbPath);
    assert.equal(report.LOCALIZATION_ENGINE_PROJECT_ID.value, "1");
    assert.equal(report.LOCALIZATION_ENGINE_INPUT_PATH.value, inputPath);
    assert.equal(report.LOCALIZATION_ENGINE_OUTPUT_PATH.value, outputPath);
    assert.equal(report.LOCALIZATION_ENGINE_TARGET_SCOPE.value, "blank-only");
    assert.equal(report.LOCALIZATION_ENGINE_JOB_ENABLED.value, "1");
    assert.equal(report.LOCALIZATION_ENGINE_CHECKPOINT_PATH.value, checkpointPath);
    assert.equal(report.LOCALIZATION_ENGINE_EVENTS_PATH.value, eventsPath);
    assert.equal(report.LOCALIZATION_ENGINE_ARTIFACTS_PATH.value, artifactsPath);
    assert.equal(report.LOCALIZATION_ENGINE_MAX_ATTEMPTS.value, "3");
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_PATH.value, snapshotPath);
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS.value, "5");
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS.value, "7");
    assert.equal(report.LOCALIZATION_ENGINE_PROGRESS_STDOUT.value, "1");
  });
});

test("translate file script passes resume flag and sanitizes stale job env vars", () => {
  withTempFixture(({ tempRoot, baseArgs }) => {
    const reportPath = path.join(tempRoot, "env-report.json");
    installFakeVitest(tempRoot, reportPath);

    const env = {
      ...process.env,
      LOCALIZATION_ENGINE_CHECKPOINT_PATH: "stale.checkpoint.jsonl",
      LOCALIZATION_ENGINE_EVENTS_PATH: "stale.events.jsonl",
      LOCALIZATION_ENGINE_ARTIFACTS_PATH: "stale.artifacts.jsonl",
      LOCALIZATION_ENGINE_MAX_ATTEMPTS: "999",
      LOCALIZATION_ENGINE_SNAPSHOT_PATH: "stale.snapshot.xlsx",
      LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS: "999",
      LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS: "999",
      LOCALIZATION_ENGINE_PROGRESS_STDOUT: "1",
      NODE_EXE: process.execPath,
      ENV_REPORT_PATH: reportPath,
    };

    const result = runScript([...baseArgs, "--resume"], {
      cwd: tempRoot,
      env,
    });

    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.LOCALIZATION_ENGINE_JOB_ENABLED.value, "1");
    assert.equal(report.LOCALIZATION_ENGINE_RESUME.value, "1");
    assert.equal(report.LOCALIZATION_ENGINE_CHECKPOINT_PATH.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_EVENTS_PATH.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_ARTIFACTS_PATH.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_MAX_ATTEMPTS.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_PATH.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS.present, false);
    assert.equal(report.LOCALIZATION_ENGINE_PROGRESS_STDOUT.present, false);
  });
});
