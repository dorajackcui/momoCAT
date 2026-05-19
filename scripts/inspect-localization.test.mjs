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
