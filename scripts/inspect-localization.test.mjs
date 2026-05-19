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

test("inspect localization script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

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
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing --db/);
});

test("inspect localization omits optional env vars when options are absent", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(repoRoot, ".tmp-inspect-localization-"),
  );
  try {
    const binDir = path.join(tempRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });

    const dbPath = path.join(tempRoot, "cat.db");
    const inputPath = path.join(tempRoot, "input.xlsx");
    const outputPath = path.join(tempRoot, "inspect.xlsx");
    const reportPath = path.join(tempRoot, "env-report.json");
    fs.writeFileSync(dbPath, "");
    fs.writeFileSync(inputPath, "");

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

    const env = { ...process.env };
    delete env.LOCALIZATION_INSPECT_JSON_OUTPUT_PATH;
    delete env.LOCALIZATION_INSPECT_UNIT_LIMIT;
    delete env.LOCALIZATION_INSPECT_MAX_CELL_CHARS;
    env.NODE_EXE = process.execPath;
    env.ENV_REPORT_PATH = reportPath;

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
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
        encoding: "utf8",
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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
