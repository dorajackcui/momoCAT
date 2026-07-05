import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { CATDatabase } from './index';
import {
  CURRENT_SCHEMA_VERSION,
  ensureCurrentSchema,
  UnsupportedDatabaseSchemaError,
} from './currentSchema';

const TEMP_ROOT = join(tmpdir(), 'simple-cat-tool-db-tests');

function createTempDbPath(): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return join(TEMP_ROOT, `${randomUUID()}.db`);
}

function hasIndex(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName);
  return Boolean(row);
}

describe('ensureCurrentSchema', () => {
  afterEach(() => {
    if (existsSync(TEMP_ROOT)) {
      rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
  });

  it('bootstraps an empty database to the current schema', () => {
    const db = new Database(':memory:');

    ensureCurrentSchema(db);

    const versionRow = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(versionRow.version).toBe(CURRENT_SCHEMA_VERSION);

    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );

    expect(tables.has('projects')).toBe(true);
    expect(tables.has('files')).toBe(true);
    expect(tables.has('segments')).toBe(true);
    expect(tables.has('tms')).toBe(true);
    expect(tables.has('project_tms')).toBe(true);
    expect(tables.has('tm_entries')).toBe(true);
    expect(tables.has('tm_fts')).toBe(true);
    expect(tables.has('term_bases')).toBe(true);
    expect(tables.has('project_term_bases')).toBe(true);
    expect(tables.has('tb_entries')).toBe(true);
    expect(tables.has('tb_fts')).toBe(true);
    const hasTmStatsIndex = hasIndex(db, 'idx_tm_entries_tm_updatedAt');
    const hasTbStatsIndex = hasIndex(db, 'idx_tb_entries_tb_updatedAt');

    db.close();

    expect(tables.has('app_settings')).toBe(true);
    expect(tables.has('project_prompts')).toBe(true);
    expect(hasTmStatsIndex).toBe(true);
    expect(hasTbStatsIndex).toBe(true);
  });

  it('reopens an already-current database without mutating the schema marker', () => {
    const dbPath = createTempDbPath();

    const first = new CATDatabase(dbPath);
    first.close();

    const before = new Database(dbPath);
    const markerBefore = before.prepare('SELECT version FROM schema_version').get() as { version: number };
    const tableCountBefore = (
      before
        .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get() as { count: number }
    ).count;
    before.close();

    const second = new CATDatabase(dbPath);
    second.close();

    const after = new Database(dbPath);
    const markerAfter = after.prepare('SELECT version FROM schema_version').get() as { version: number };
    const tableCountAfter = (
      after
        .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get() as { count: number }
    ).count;

    expect(markerBefore.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(markerAfter.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(tableCountAfter).toBe(tableCountBefore);
    after.close();
  });

  it('rejects a non-empty database with no schema marker', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE legacy_projects (
        id INTEGER PRIMARY KEY
      );
    `);

    expect(() => ensureCurrentSchema(db)).toThrowError(UnsupportedDatabaseSchemaError);
    db.close();
  });

  it('rejects a non-current schema marker', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION - 1});
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );
    `);

    expect(() => ensureCurrentSchema(db)).toThrowError(UnsupportedDatabaseSchemaError);
    db.close();
  });

  it('rejects a marker-only database that is missing required current tables', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION});
    `);

    expect(() => ensureCurrentSchema(db)).toThrowError(UnsupportedDatabaseSchemaError);
    db.close();
  });

  it('restores TM and TB stats performance indexes on current databases', () => {
    const dbPath = createTempDbPath();

    const first = new CATDatabase(dbPath);
    first.close();

    const before = new Database(dbPath);
    before.prepare('DROP INDEX IF EXISTS idx_tm_entries_tm_updatedAt').run();
    before.prepare('DROP INDEX IF EXISTS idx_tb_entries_tb_updatedAt').run();
    expect(hasIndex(before, 'idx_tm_entries_tm_updatedAt')).toBe(false);
    expect(hasIndex(before, 'idx_tb_entries_tb_updatedAt')).toBe(false);
    before.close();

    const reopened = new CATDatabase(dbPath);
    reopened.close();

    const after = new Database(dbPath);
    const markerAfter = after.prepare('SELECT version FROM schema_version').get() as { version: number };

    const hasTmStatsIndex = hasIndex(after, 'idx_tm_entries_tm_updatedAt');
    const hasTbStatsIndex = hasIndex(after, 'idx_tb_entries_tb_updatedAt');
    after.close();

    expect(markerAfter.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(hasTmStatsIndex).toBe(true);
    expect(hasTbStatsIndex).toBe(true);
  });

  it('creates the project_prompts table on existing current databases that lack it', () => {
    const dbPath = createTempDbPath();

    const first = new CATDatabase(dbPath);
    first.close();

    // Simulate a database created before the saved-prompts feature.
    const before = new Database(dbPath);
    before.exec('DROP TABLE IF EXISTS project_prompts');
    before.close();

    const reopened = new CATDatabase(dbPath);
    reopened.close();

    const after = new Database(dbPath);
    const table = after
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_prompts'")
      .get();
    after.close();

    expect(table).toBeDefined();
  });
});
