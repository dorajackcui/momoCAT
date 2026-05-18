import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts", "inspect-projects.mjs");

test("inspect projects script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /inspect-projects\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--json/);
});

test("inspect projects script prints JSON project, resource, file, and provider status", () => {
  const dbPath = createFixtureDb();

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--db", dbPath, "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);

  assert.equal(summary.projects.length, 1);
  assert.deepEqual(summary.providers, [
    {
      id: "custom:test-provider",
      name: "Test Provider",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
      kind: "custom",
      apiKeySet: true,
      apiKeyLast4: "7890",
    },
  ]);
  assert.equal(summary.projects[0].id, 7);
  assert.equal(summary.projects[0].model.id, "custom:test-provider");
  assert.equal(summary.projects[0].model.apiKeySet, true);
  assert.equal(summary.projects[0].mountedTMs[0].name, "Client Main TM");
  assert.equal(summary.projects[0].mountedTBs[0].name, "Client Terms");
  assert.equal(summary.projects[0].files[0].id, 11);
  assert.equal(summary.projects[0].files[0].targetRows, 1);
  assert.deepEqual(summary.projects[0].files[0].statusCounts, {
    new: 1,
    translated: 1,
  });
});

test("inspect projects script filters by project id in text output", () => {
  const dbPath = createFixtureDb();

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--db", dbPath, "--project-id", "7"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Project 7: Fixture Project/);
  assert.match(result.stdout, /model: custom:test-provider/);
  assert.match(result.stdout, /apiKey: set/);
  assert.match(result.stdout, /mounted TM: 1/);
  assert.match(result.stdout, /file 11: fixture.xlsx/);
});

function createFixtureDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-inspect-projects-"));
  const dbPath = path.join(dir, "cat_v1.db");
  const db = new Database(dbPath);

  db.exec(`
    create table app_settings (key text primary key, value text, updatedAt text);
    create table projects (
      id integer primary key,
      name text,
      srcLang text,
      tgtLang text,
      projectType text,
      aiPrompt text,
      aiModel text
    );
    create table files (
      id integer primary key,
      projectId integer,
      name text,
      totalSegments integer,
      confirmedSegments integer
    );
    create table segments (
      segmentId text primary key,
      fileId integer,
      targetTokensJson text,
      status text
    );
    create table tms (
      id text primary key,
      name text,
      srcLang text,
      tgtLang text,
      type text
    );
    create table project_tms (
      projectId integer,
      tmId text,
      priority integer,
      permission text,
      isEnabled integer
    );
    create table term_bases (
      id text primary key,
      name text,
      srcLang text,
      tgtLang text
    );
    create table project_term_bases (
      projectId integer,
      tbId text,
      priority integer,
      isEnabled integer
    );
  `);

  db.prepare("insert into app_settings (key, value) values (?, ?)").run(
    "ai_provider_catalog_v1",
    JSON.stringify([
      {
        id: "custom:test-provider",
        name: "Test Provider",
        baseUrl: "https://example.invalid/v1",
        model: "test-model",
        protocol: "chat-completions",
        kind: "custom",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
  );
  db.prepare("insert into app_settings (key, value) values (?, ?)").run(
    "ai_provider_key::custom:test-provider",
    "sk-test-1234567890",
  );
  db.prepare(
    "insert into projects (id, name, srcLang, tgtLang, projectType, aiPrompt, aiModel) values (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    7,
    "Fixture Project",
    "en-US",
    "zh-CN",
    "translation",
    "Use concise style.",
    "custom:test-provider",
  );
  db.prepare(
    "insert into files (id, projectId, name, totalSegments, confirmedSegments) values (?, ?, ?, ?, ?)",
  ).run(11, 7, "fixture.xlsx", 2, 0);
  const insertSegment = db.prepare(
    "insert into segments (segmentId, fileId, targetTokensJson, status) values (?, ?, ?, ?)",
  );
  insertSegment.run("seg-1", 11, "[]", "new");
  insertSegment.run(
    "seg-2",
    11,
    '[{"type":"text","content":"你好"}]',
    "translated",
  );
  db.prepare(
    "insert into tms (id, name, srcLang, tgtLang, type) values (?, ?, ?, ?, ?)",
  ).run("tm-main", "Client Main TM", "en-US", "zh-CN", "main");
  db.prepare(
    "insert into project_tms (projectId, tmId, priority, permission, isEnabled) values (?, ?, ?, ?, ?)",
  ).run(7, "tm-main", 10, "read", 1);
  db.prepare(
    "insert into term_bases (id, name, srcLang, tgtLang) values (?, ?, ?, ?)",
  ).run("tb-main", "Client Terms", "en-US", "zh-CN");
  db.prepare(
    "insert into project_term_bases (projectId, tbId, priority, isEnabled) values (?, ?, ?, ?)",
  ).run(7, "tb-main", 20, 1);

  db.close();
  return dbPath;
}
