import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts", "inspect-localization.mjs");

function runScript(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: options.env,
    encoding: "utf8",
  });
}

function withTempFixture(callback) {
  const tempRoot = fs.mkdtempSync(
    path.join(repoRoot, ".tmp-inspect-localization-"),
  );
  try {
    const dbPath = path.join(tempRoot, "cat.db");
    const inputPath = path.join(tempRoot, "input.xlsx");
    const outputPath = path.join(tempRoot, "inspect.xlsx");
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

test("inspect localization script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = runScript(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /inspect-localization\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--db-path <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--input <path>/);
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--json-output <path>/);
  assert.match(result.stdout, /--unit-limit <n>/);
  assert.match(result.stdout, /--max-cell-chars <n>/);
});

test("inspect localization script validates missing db", () => {
  const result = runScript([]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing --db/);
});

test("inspect localization validates empty equals values", () => {
  for (const [flag, pattern] of [
    ["--db=", /Missing value for --db\./],
    ["--json-output=", /Missing value for --json-output\./],
    ["--unit-limit=", /Missing value for --unit-limit\./],
    ["--max-cell-chars=", /Missing value for --max-cell-chars\./],
  ]) {
    const result = runScript([flag]);
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, pattern, flag);
  }
});

test("inspect localization validates common invalid arguments", () => {
  withTempFixture(({ baseArgs, dbPath, inputPath, outputPath }) => {
    const cases = [
      {
        args: ["--wat"],
        pattern: /Unknown argument: --wat/,
      },
      {
        args: [
          "--db",
          dbPath,
          "--project-id",
          "0",
          "--input",
          inputPath,
          "--output",
          outputPath,
        ],
        pattern: /--project-id must be a positive integer\./,
      },
      {
        args: [...baseArgs, "--unit-limit", "0"],
        pattern: /--unit-limit must be a positive integer\./,
      },
      {
        args: [...baseArgs, "--max-cell-chars", "nope"],
        pattern: /--max-cell-chars must be a positive integer\./,
      },
    ];

    for (const { args, pattern } of cases) {
      const result = runScript(args);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.match(result.stderr, pattern, args.join(" "));
    }
  });
});

test("inspect localization omits optional env vars when options are absent", () => {
  withTempFixture(({ tempRoot, dbPath, inputPath, outputPath }) => {
    const binDir = path.join(tempRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });

    const reportPath = path.join(tempRoot, "env-report.json");

    const fakeVitestScript = path.join(binDir, "vitest-check.mjs");
    fs.writeFileSync(
      fakeVitestScript,
      `import fs from "node:fs";

const names = [
  "LOCALIZATION_INSPECT_JSON_OUTPUT_PATH",
  "LOCALIZATION_INSPECT_UNIT_LIMIT",
  "LOCALIZATION_INSPECT_MAX_CELL_CHARS",
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

    const env = {
      ...process.env,
      LOCALIZATION_INSPECT_JSON_OUTPUT_PATH: "stale.json",
      LOCALIZATION_INSPECT_UNIT_LIMIT: "999",
      LOCALIZATION_INSPECT_MAX_CELL_CHARS: "999",
    };
    env.NODE_EXE = process.execPath;
    env.ENV_REPORT_PATH = reportPath;

    const result = runScript(
      [
        "--db",
        dbPath,
        "--project-id",
        "1",
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      {
        cwd: tempRoot,
        env,
      },
    );

    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.LOCALIZATION_INSPECT_JSON_OUTPUT_PATH.present, false);
    assert.equal(report.LOCALIZATION_INSPECT_UNIT_LIMIT.present, false);
    assert.equal(report.LOCALIZATION_INSPECT_MAX_CELL_CHARS.present, false);
  });
});
