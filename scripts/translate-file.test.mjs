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
const scriptPath = path.join(repoRoot, "scripts", "translate-file.mjs");

test("translate file script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /translate-file\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--input <path>/);
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--target-scope <scope>/);
});
