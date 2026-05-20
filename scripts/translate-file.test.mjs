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

function runScript(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: options.env,
    encoding: "utf8",
  });
}

function withTempFixture(callback) {
  const tempRoot = fs.mkdtempSync(path.join(repoRoot, ".tmp-translate-file-"));
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

function installFakeRunner(tempRoot, reportPath) {
  const fakeRunnerScript = path.join(tempRoot, "translate-file-runner.mjs");
  fs.writeFileSync(
    fakeRunnerScript,
    `import fs from "node:fs";

export async function run(config) {
  fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(config), "utf8");
}
`,
  );
  return fakeRunnerScript;
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

test("translate file script passes explicit job paths and options to runner", () => {
  withTempFixture(({ tempRoot, dbPath, inputPath, outputPath }) => {
    const reportPath = path.join(tempRoot, "runner-report.json");
    const runnerPath = installFakeRunner(tempRoot, reportPath);

    const checkpointPath = path.join(tempRoot, "custom.checkpoint.jsonl");
    const eventsPath = path.join(tempRoot, "custom.events.jsonl");
    const artifactsPath = path.join(tempRoot, "custom.artifacts.jsonl");
    const snapshotPath = path.join(tempRoot, "custom.snapshot.xlsx");
    const env = {
      ...process.env,
      TRANSLATE_FILE_RUNNER: runnerPath,
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
    assert.deepEqual(report, {
      dbPath,
      projectId: 1,
      inputPath,
      outputPath,
      targetScope: "blank-only",
      checkpointPath,
      eventsPath,
      artifactsPath,
      resume: false,
      maxAttempts: 3,
      snapshotPath,
      snapshotEveryUnits: 5,
      snapshotEverySeconds: 7,
      progressStdout: true,
    });
  });
});

test("translate file script passes resume flag and omits absent optionals", () => {
  withTempFixture(({ tempRoot, baseArgs }) => {
    const reportPath = path.join(tempRoot, "runner-report.json");
    const runnerPath = installFakeRunner(tempRoot, reportPath);

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
      TRANSLATE_FILE_RUNNER: runnerPath,
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
    assert.equal(report.resume, true);
    assert.equal(report.targetScope, undefined);
    assert.equal(report.checkpointPath, undefined);
    assert.equal(report.eventsPath, undefined);
    assert.equal(report.artifactsPath, undefined);
    assert.equal(report.maxAttempts, undefined);
    assert.equal(report.snapshotPath, undefined);
    assert.equal(report.snapshotEveryUnits, undefined);
    assert.equal(report.snapshotEverySeconds, undefined);
    assert.equal(report.progressStdout, false);
  });
});
