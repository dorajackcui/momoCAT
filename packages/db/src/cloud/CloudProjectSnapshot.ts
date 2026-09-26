import Database from 'better-sqlite3';
import { ensureCurrentSchema } from '../currentSchema';

type Cell = string | number | null;
export type SnapshotRows = Record<string, Record<string, Cell>[]>;
export interface CloudProjectSnapshot {
  schema: 15;
  projectId: number;
  tables: SnapshotRows;
}

// Explicit column allowlist: never include app_settings, provider credentials,
// local file links, scratch tables, or future columns by accident.
const columns = {
  projects:
    'id,uuid,name,srcLang,tgtLang,projectType,aiPrompt,aiTemperature,aiModel,qaSettingsJson,createdAt,updatedAt',
  files:
    'id,uuid,projectId,name,totalSegments,confirmedSegments,importOptionsJson,createdAt,updatedAt',
  segments:
    'segmentId,fileId,orderIndex,sourceTokensJson,targetTokensJson,status,tagsSignature,matchKey,srcHash,metaJson,qaIssuesJson,updatedAt',
  project_prompts: 'id,projectId,name,content,createdAt,updatedAt',
  tms: 'id,name,srcLang,tgtLang,type,createdAt,updatedAt',
  project_tms: 'projectId,tmId,priority,permission,isEnabled',
  tm_entries:
    'id,tmId,srcHash,matchKey,tagsSignature,sourceTokensJson,targetTokensJson,originSegmentId,createdAt,updatedAt,usageCount,ftsRowid',
  tm_fts: 'rowid,tmId,srcText,tgtText,tmEntryId',
  term_bases: 'id,name,srcLang,tgtLang,createdAt,updatedAt',
  project_term_bases: 'projectId,tbId,priority,isEnabled',
  tb_entries: 'id,tbId,srcTerm,tgtTerm,srcNorm,note,createdAt,updatedAt,usageCount,ftsRowid',
  tb_fts: 'rowid,tbId,srcText,tbEntryId',
} as const;
type Table = keyof typeof columns;
const stateTables: Table[] = [
  'projects',
  'files',
  'segments',
  'project_prompts',
  'tm_entries',
  'tm_fts',
];
const resourceTables: Table[] = [
  'tms',
  'project_tms',
  'term_bases',
  'project_term_bases',
  'tm_entries',
  'tm_fts',
  'tb_entries',
  'tb_fts',
];

function readRows(db: Database.Database, table: Table, predicate: string, projectId: number) {
  return db
    .prepare(`SELECT ${columns[table]} FROM ${table} WHERE ${predicate} ORDER BY rowid`)
    .all(projectId) as Record<string, Cell>[];
}

function exportPart(
  db: Database.Database,
  projectId: number,
  resources: boolean,
  includeUnmounted = false,
): CloudProjectSnapshot {
  const mountedTMs = includeUnmounted
    ? 'SELECT id FROM tms WHERE ? > 0'
    : 'SELECT tmId FROM project_tms WHERE projectId = ?';
  const working = `SELECT id FROM tms WHERE id IN (${mountedTMs}) AND type = 'working'`;
  const main = `SELECT id FROM tms WHERE id IN (${mountedTMs}) AND type != 'working'`;
  const tb = includeUnmounted
    ? 'SELECT id FROM term_bases WHERE ? > 0'
    : 'SELECT tbId FROM project_term_bases WHERE projectId = ?';
  const conditions: Record<Table, string> = {
    projects: 'id = ?',
    files: 'projectId = ?',
    segments: 'fileId IN (SELECT id FROM files WHERE projectId = ?)',
    project_prompts: 'projectId = ?',
    tms: `id IN (${mountedTMs})`,
    project_tms: 'projectId = ?',
    tm_entries: `tmId IN (${resources ? main : working})`,
    tm_fts: `tmId IN (${resources ? main : working})`,
    term_bases: `id IN (${tb})`,
    project_term_bases: 'projectId = ?',
    tb_entries: `tbId IN (${tb})`,
    tb_fts: `tbId IN (${tb})`,
  };
  const tables: SnapshotRows = {};
  for (const table of resources ? resourceTables : stateTables)
    tables[table] = readRows(db, table, conditions[table], projectId);
  return { schema: 15, projectId, tables };
}

export function exportCloudProject(dbPath: string, projectId: number) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId))
        throw new Error('Project not found');
      return {
        state: exportPart(db, projectId, false),
        resources: exportPart(db, projectId, true),
      };
    })();
  } finally {
    db.close();
  }
}

function validatePart(input: unknown, resources: boolean): CloudProjectSnapshot {
  const value = input as CloudProjectSnapshot;
  if (
    !value ||
    value.schema !== 15 ||
    !Number.isSafeInteger(value.projectId) ||
    value.projectId <= 0 ||
    !value.tables
  )
    throw new Error('Unsupported cloud snapshot');
  const expected = resources ? resourceTables : stateTables;
  if (Object.keys(value.tables).length !== expected.length)
    throw new Error('Invalid snapshot tables');
  for (const table of expected) {
    const rows = value.tables[table];
    const keys = columns[table].split(',');
    if (!Array.isArray(rows) || rows.length > 500_000) throw new Error('Invalid snapshot rows');
    for (const row of rows) {
      if (
        !row ||
        Object.keys(row).length !== keys.length ||
        !keys.every(
          (key) =>
            Object.hasOwn(row, key) &&
            (row[key] === null ||
              typeof row[key] === 'string' ||
              (typeof row[key] === 'number' && Number.isFinite(row[key]))),
        )
      )
        throw new Error('Invalid snapshot columns');
    }
  }
  return value;
}

export function restoreCloudProject(
  dbPath: string,
  stateInput: unknown,
  resourcesInput: unknown,
): number {
  const state = validatePart(stateInput, false);
  const resources = validatePart(resourcesInput, true);
  if (
    state.projectId !== resources.projectId ||
    state.tables.projects.length !== 1 ||
    state.tables.projects[0].id !== state.projectId
  )
    throw new Error('Cloud project identity mismatch');
  for (const file of state.tables.files) {
    if (
      !Number.isSafeInteger(file.id) ||
      Number(file.id) < 1 ||
      typeof file.name !== 'string' ||
      !file.name ||
      file.name === '.' ||
      file.name === '..' ||
      /[\\/:]/.test(file.name) ||
      [...file.name].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('Unsafe project filename');
  }
  const db = new Database(dbPath);
  try {
    ensureCurrentSchema(db, { allowSchemaMaintenance: true });
    if (db.prepare('SELECT 1 FROM projects LIMIT 1').get())
      throw new Error('Cloud restore requires an empty cache');
    db.pragma('foreign_keys = ON');
    db.transaction(() => {
      for (const table of Object.keys(columns) as Table[]) {
        const rows = [...(state.tables[table] ?? []), ...(resources.tables[table] ?? [])];
        const keys = columns[table].split(',');
        const insert = db.prepare(
          `INSERT INTO ${table} (${columns[table]}) VALUES (${keys.map(() => '?').join(',')})`,
        );
        for (const row of rows) insert.run(...keys.map((key) => row[key]));
      }
      if (
        db.prepare('SELECT 1 FROM files WHERE projectId != ?').get(state.projectId) ||
        db.prepare('SELECT 1 FROM project_tms WHERE projectId != ?').get(state.projectId) ||
        db.prepare('SELECT 1 FROM project_term_bases WHERE projectId != ?').get(state.projectId) ||
        db.prepare('SELECT 1 FROM project_prompts WHERE projectId != ?').get(state.projectId)
      )
        throw new Error('Snapshot contains another project');
    })();
    return state.projectId;
  } finally {
    db.close();
  }
}

export class CloudSnapshotOutbox {
  private readonly db: Database.Database;
  constructor(
    dbPath: string,
    private readonly projectId: number,
  ) {
    this.db = new Database(dbPath);
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_outbox (
      id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL DEFAULT 0,
      confirmed INTEGER NOT NULL DEFAULT 0, pending TEXT
    ); INSERT OR IGNORE INTO cloud_outbox(id) VALUES (1);`);
    for (const table of Object.keys(columns)) {
      // Virtual tables cannot have triggers; repositories update their source rows
      // in the same transaction as the FTS index.
      if (table.endsWith('_fts')) continue;
      for (const action of ['INSERT', 'UPDATE', 'DELETE'])
        this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS cloud_dirty_${table}_${action} AFTER ${action} ON ${table}
        BEGIN UPDATE cloud_outbox SET generation = generation + 1 WHERE id = 1; END;`);
    }
  }

  status(): { generation: number; confirmed: number; pending: string | null } {
    return this.db
      .prepare('SELECT generation, confirmed, pending FROM cloud_outbox WHERE id = 1')
      .get() as ReturnType<CloudSnapshotOutbox['status']>;
  }

  prepare(
    operationId: string,
    revision: number,
    captureFiles: (rows: Record<string, Cell>[]) => { id: number; chunks: string[] }[] = () => [],
  ): string | null {
    return this.db.transaction(() => {
      const status = this.status();
      if (status.pending) return status.pending;
      if (status.generation === status.confirmed) return null;
      const state = exportPart(this.db, this.projectId, false);
      const pending = JSON.stringify({
        operationId,
        revision,
        generation: status.generation,
        state,
        resources: exportPart(this.db, this.projectId, true, true),
        files: captureFiles(state.tables.files),
      });
      this.db.prepare('UPDATE cloud_outbox SET pending = ? WHERE id = 1').run(pending);
      return pending;
    })();
  }

  acknowledge(operationId: string): void {
    this.db.transaction(() => {
      const pending = this.status().pending;
      if (!pending) return;
      const saved = JSON.parse(pending) as { operationId: string; generation: number };
      if (saved.operationId !== operationId) throw new Error('Outbox operation mismatch');
      this.db
        .prepare('UPDATE cloud_outbox SET confirmed = ?, pending = NULL WHERE id = 1')
        .run(saved.generation);
    })();
  }

  close(): void {
    this.db.close();
  }
}
