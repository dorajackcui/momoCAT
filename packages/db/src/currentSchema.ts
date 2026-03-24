import type Database from 'better-sqlite3';
import { DEFAULT_PROJECT_AI_MODEL, DEFAULT_PROJECT_QA_SETTINGS } from '@cat/core';

export const CURRENT_SCHEMA_VERSION = 14;

const CURRENT_QA_SETTINGS_JSON = JSON.stringify(DEFAULT_PROJECT_QA_SETTINGS);

const REQUIRED_TABLES = [
  'schema_version',
  'projects',
  'files',
  'segments',
  'tms',
  'project_tms',
  'tm_entries',
  'tm_fts',
  'term_bases',
  'project_term_bases',
  'tb_entries',
  'app_settings',
] as const;

const REQUIRED_COLUMNS: Record<string, string[]> = {
  projects: [
    'id',
    'uuid',
    'name',
    'srcLang',
    'tgtLang',
    'projectType',
    'aiPrompt',
    'aiTemperature',
    'aiModel',
    'qaSettingsJson',
    'createdAt',
    'updatedAt',
  ],
  files: [
    'id',
    'uuid',
    'projectId',
    'name',
    'totalSegments',
    'confirmedSegments',
    'importOptionsJson',
    'createdAt',
    'updatedAt',
  ],
  segments: [
    'segmentId',
    'fileId',
    'orderIndex',
    'sourceTokensJson',
    'targetTokensJson',
    'status',
    'tagsSignature',
    'matchKey',
    'srcHash',
    'metaJson',
    'qaIssuesJson',
    'updatedAt',
  ],
  tms: ['id', 'name', 'srcLang', 'tgtLang', 'type', 'createdAt', 'updatedAt'],
  project_tms: ['projectId', 'tmId', 'priority', 'permission', 'isEnabled'],
  tm_entries: [
    'id',
    'tmId',
    'srcHash',
    'matchKey',
    'tagsSignature',
    'sourceTokensJson',
    'targetTokensJson',
    'originSegmentId',
    'createdAt',
    'updatedAt',
    'usageCount',
  ],
  term_bases: ['id', 'name', 'srcLang', 'tgtLang', 'createdAt', 'updatedAt'],
  project_term_bases: ['projectId', 'tbId', 'priority', 'isEnabled'],
  tb_entries: [
    'id',
    'tbId',
    'srcTerm',
    'tgtTerm',
    'srcNorm',
    'note',
    'createdAt',
    'updatedAt',
    'usageCount',
  ],
  app_settings: ['key', 'value', 'updatedAt'],
  schema_version: ['version'],
};

export class UnsupportedDatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDatabaseSchemaError';
  }
}

export function ensureCurrentSchema(db: Database.Database): void {
  if (isDatabaseEmpty(db)) {
    createCurrentSchema(db);
    return;
  }

  assertCurrentSchemaMarker(db);
  assertCurrentSchemaShape(db);
}

function isDatabaseEmpty(db: Database.Database): boolean {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `,
    )
    .get() as { count: number };

  return row.count === 0;
}

function createCurrentSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY CHECK (version = ${CURRENT_SCHEMA_VERSION})
      );

      INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION});

      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        srcLang TEXT NOT NULL,
        tgtLang TEXT NOT NULL,
        projectType TEXT NOT NULL DEFAULT 'translation',
        aiPrompt TEXT,
        aiTemperature REAL,
        aiModel TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_AI_MODEL}',
        qaSettingsJson TEXT NOT NULL DEFAULT '${CURRENT_QA_SETTINGS_JSON}',
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        projectId INTEGER NOT NULL,
        name TEXT NOT NULL,
        totalSegments INTEGER DEFAULT 0,
        confirmedSegments INTEGER DEFAULT 0,
        importOptionsJson TEXT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE segments (
        segmentId TEXT PRIMARY KEY,
        fileId INTEGER NOT NULL,
        orderIndex INTEGER NOT NULL,
        sourceTokensJson TEXT NOT NULL,
        targetTokensJson TEXT NOT NULL,
        status TEXT NOT NULL,
        tagsSignature TEXT NOT NULL,
        matchKey TEXT NOT NULL,
        srcHash TEXT NOT NULL,
        metaJson TEXT NOT NULL,
        qaIssuesJson TEXT,
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE
      );

      CREATE TABLE tms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        srcLang TEXT NOT NULL,
        tgtLang TEXT NOT NULL,
        type TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE project_tms (
        projectId INTEGER NOT NULL,
        tmId TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        permission TEXT NOT NULL DEFAULT 'read',
        isEnabled INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(projectId, tmId),
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (tmId) REFERENCES tms(id) ON DELETE CASCADE
      );

      CREATE TABLE tm_entries (
        id TEXT PRIMARY KEY,
        tmId TEXT NOT NULL,
        srcHash TEXT NOT NULL,
        matchKey TEXT NOT NULL,
        tagsSignature TEXT NOT NULL,
        sourceTokensJson TEXT NOT NULL,
        targetTokensJson TEXT NOT NULL,
        originSegmentId TEXT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (tmId) REFERENCES tms(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE tm_fts USING fts5(
        tmId UNINDEXED,
        srcText,
        tgtText,
        tmEntryId UNINDEXED
      );

      CREATE TABLE term_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        srcLang TEXT NOT NULL,
        tgtLang TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE project_term_bases (
        projectId INTEGER NOT NULL,
        tbId TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 10,
        isEnabled INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(projectId, tbId),
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (tbId) REFERENCES term_bases(id) ON DELETE CASCADE
      );

      CREATE TABLE tb_entries (
        id TEXT PRIMARY KEY,
        tbId TEXT NOT NULL,
        srcTerm TEXT NOT NULL,
        tgtTerm TEXT NOT NULL,
        srcNorm TEXT NOT NULL,
        note TEXT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (tbId) REFERENCES term_bases(id) ON DELETE CASCADE
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX idx_files_project ON files(projectId);
      CREATE INDEX idx_segments_file_order ON segments(fileId, orderIndex);
      CREATE INDEX idx_segments_file_srcHash ON segments(fileId, srcHash);
      CREATE INDEX idx_project_tms_project ON project_tms(projectId, isEnabled, priority);
      CREATE INDEX idx_tm_entries_tm_srcHash ON tm_entries(tmId, srcHash);
      CREATE INDEX idx_tm_entries_tm_matchKey ON tm_entries(tmId, matchKey);
      CREATE UNIQUE INDEX idx_tm_entries_tm_srcHash_unique ON tm_entries(tmId, srcHash);
      CREATE INDEX idx_project_tbs_project ON project_term_bases(projectId, isEnabled, priority);
      CREATE INDEX idx_tb_entries_tb_src ON tb_entries(tbId, srcNorm);
      CREATE INDEX idx_tb_entries_tb_src_term ON tb_entries(tbId, srcTerm);
      CREATE UNIQUE INDEX idx_tb_entries_tb_src_unique ON tb_entries(tbId, srcNorm);
    `);
  })();
}

function assertCurrentSchemaMarker(db: Database.Database): void {
  const markerTable = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_version'
      `,
    )
    .get() as { name: string } | undefined;

  if (!markerTable) {
    throw new UnsupportedDatabaseSchemaError(
      `Database is not using the current schema marker (expected v${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  const versionRows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
  if (versionRows.length !== 1 || versionRows[0].version !== CURRENT_SCHEMA_VERSION) {
    const foundVersion =
      versionRows.length === 1 ? `v${versionRows[0].version}` : `${versionRows.length} marker rows`;
    throw new UnsupportedDatabaseSchemaError(
      `Database schema ${foundVersion} is unsupported; expected v${CURRENT_SCHEMA_VERSION}.`,
    );
  }
}

function assertCurrentSchemaShape(db: Database.Database): void {
  const tables = new Set(
    (
      db
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          `,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );

  for (const tableName of REQUIRED_TABLES) {
    if (!tables.has(tableName)) {
      throw new UnsupportedDatabaseSchemaError(
        `Database schema is missing required table "${tableName}".`,
      );
    }
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = new Set(
      (
        db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
      ).map((column) => column.name),
    );

    for (const columnName of requiredColumns) {
      if (!columns.has(columnName)) {
        throw new UnsupportedDatabaseSchemaError(
          `Database schema is missing required column "${tableName}.${columnName}".`,
        );
      }
    }
  }
}
