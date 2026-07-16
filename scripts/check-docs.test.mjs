import assert from "node:assert/strict";
import test from "node:test";
import {
  findMarkdownTableErrors,
  findNpmRunCommands,
  splitMarkdownTableRow,
} from "./check-docs.mjs";

test("markdown table parser treats unescaped pipes as column boundaries", () => {
  assert.deepEqual(
    splitMarkdownTableRow("| `window | window-partial` | meaning |"),
    ["`window", "window-partial`", "meaning"],
  );
  assert.deepEqual(
    splitMarkdownTableRow("| `window \\| window-partial` | meaning |"),
    ["`window \\| window-partial`", "meaning"],
  );
});

test("markdown table validation rejects rows that do not match the header", () => {
  const malformed = [
    "| Option | Meaning |",
    "| --- | --- | --- |",
    "| `window | window-partial` | Select a mode. |",
  ].join("\n");

  assert.deepEqual(findMarkdownTableErrors(malformed), [
    {
      line: 2,
      message: "table delimiter has 3 columns; header has 2",
    },
    {
      line: 3,
      message: "table row has 3 columns; header has 2",
    },
  ]);
  assert.deepEqual(
    findMarkdownTableErrors(
      "| Option | Meaning |\n| --- | --- |\n| `window` or `partial` | Select. |",
    ),
    [],
  );
});

test("npm command parsing preserves root and workspace context", () => {
  assert.deepEqual(
    findNpmRunCommands(
      [
        "npm run docs:check",
        "npm --silent run cli -- --help",
        "npm run test:e2e:smoke --workspace=apps/desktop",
      ].join("\n"),
    ).map(({ script, workspace }) => ({ script, workspace })),
    [
      { script: "docs:check", workspace: undefined },
      { script: "cli", workspace: undefined },
      { script: "test:e2e:smoke", workspace: "apps/desktop" },
    ],
  );
});
