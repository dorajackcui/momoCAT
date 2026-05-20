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

test("forbidden specifier patterns match raw desktop imports", async () => {
  const { matchesForbiddenSpecifierPatterns } = await import(
    "./gate-architecture-check.mjs"
  );

  const patterns = [
    "^apps/desktop/src/main(?:/|$)",
    "^apps/desktop/src/shared(?:/|$)",
    "^@desktop/(?:main|shared)(?:/|$)",
  ];

  assert.equal(
    matchesForbiddenSpecifierPatterns("apps/desktop/src/main/services/ProjectService", patterns),
    true,
  );
  assert.equal(
    matchesForbiddenSpecifierPatterns("apps/desktop/src/shared/ipc", patterns),
    true,
  );
  assert.equal(matchesForbiddenSpecifierPatterns("@desktop/shared/ipc", patterns), true);
  assert.equal(matchesForbiddenSpecifierPatterns("@cat/core", patterns), false);
});

test("gate architecture rejects raw desktop specifiers in localization", () => {
  const fixturePath = path.join(
    repoRoot,
    "packages",
    "localization",
    "src",
    "__forbidden_raw_import_smoke__.ts",
  );

  fs.writeFileSync(
    fixturePath,
    'import "apps/desktop/src/shared/ipc";\nexport const marker = true;\n',
    "utf8",
  );

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "gate-architecture-check.mjs")],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /desktop shared IPC code/);
    assert.match(result.stderr, /apps\/desktop\/src\/shared\/ipc/);
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});
