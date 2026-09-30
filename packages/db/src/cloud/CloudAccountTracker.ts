import Database from 'better-sqlite3';

export type CloudObjectKind = 'project' | 'tm' | 'tb';
export interface CloudTrackedObject {
  kind: CloudObjectKind;
  id: string;
  generation: number;
  confirmed: number;
  revision: number;
  signature: string;
  pending: string | null;
  lastSyncedAt: string | null;
}

// This is a versioned cloud-cache extension, never installed in the local DB.
// Mutation triggers participate in the same transaction as ordinary CAT writes.
export class CloudAccountTracker {
  private readonly db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_cache_format(version INTEGER NOT NULL);
      INSERT INTO cloud_cache_format SELECT 2 WHERE NOT EXISTS(SELECT 1 FROM cloud_cache_format);
      CREATE TABLE IF NOT EXISTS cloud_objects(
        kind TEXT NOT NULL, id TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
        signature TEXT NOT NULL DEFAULT '', pending TEXT, lastSyncedAt TEXT,
        PRIMARY KEY(kind,id)
      );
    `);
    const versions = this.db.prepare('SELECT version FROM cloud_cache_format').all() as {
      version: number;
    }[];
    if (versions.length !== 1 || versions[0].version !== 2)
      throw new Error('Unsupported cloud cache format');
    const project = (predicate: string) =>
      `SELECT 'project' AS kind,uuid AS id FROM projects WHERE ${predicate}`;
    const tm = (
      expression: string,
    ) => `SELECT 'tm' AS kind,id AS id FROM tms WHERE id=${expression} AND type='main'
      UNION ALL SELECT 'project' AS kind,p.uuid AS id FROM projects p JOIN project_tms m ON m.projectId=p.id
      JOIN tms t ON t.id=m.tmId WHERE t.id=${expression} AND t.type='working'`;
    const sources: Record<string, (row: string) => string> = {
      projects: (row) => project(`id=${row}.id`),
      files: (row) => project(`id=${row}.projectId`),
      segments: (row) => project(`id IN (SELECT projectId FROM files WHERE id=${row}.fileId)`),
      project_prompts: (row) => project(`id=${row}.projectId`),
      project_tms: (row) => project(`id=${row}.projectId`),
      project_term_bases: (row) => project(`id=${row}.projectId`),
      tms: (row) => tm(`${row}.id`),
      tm_entries: (row) => tm(`${row}.tmId`),
      term_bases: (row) => `SELECT 'tb' AS kind,${row}.id AS id`,
      tb_entries: (row) => `SELECT 'tb' AS kind,${row}.tbId AS id`,
    };
    for (const [table, select] of Object.entries(sources)) {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const row = operation === 'DELETE' ? 'OLD' : 'NEW';
        const timing = operation === 'DELETE' ? 'BEFORE' : 'AFTER';
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS cloud_v2_${table}_${operation}
          ${timing} ${operation} ON ${table} BEGIN
          INSERT INTO cloud_objects(kind,id,generation)
          SELECT kind,id,1 FROM (${select(row)}) WHERE 1
          ON CONFLICT(kind,id) DO UPDATE SET generation=generation+1;
          END;`);
      }
    }
  }
  get(kind: CloudObjectKind, id: string): CloudTrackedObject | undefined {
    return this.db.prepare('SELECT * FROM cloud_objects WHERE kind=? AND id=?').get(kind, id) as
      | CloudTrackedObject
      | undefined;
  }
  list(): CloudTrackedObject[] {
    return this.db.prepare('SELECT * FROM cloud_objects').all() as CloudTrackedObject[];
  }
  ensure(kind: CloudObjectKind, id: string): CloudTrackedObject {
    this.db.prepare('INSERT OR IGNORE INTO cloud_objects(kind,id) VALUES(?,?)').run(kind, id);
    return this.get(kind, id)!;
  }
  prepare(kind: CloudObjectKind, id: string, pending: string): void {
    this.ensure(kind, id);
    this.db
      .prepare('UPDATE cloud_objects SET pending=? WHERE kind=? AND id=? AND pending IS NULL')
      .run(pending, kind, id);
  }
  acknowledge(
    kind: CloudObjectKind,
    id: string,
    revision: number,
    signature: string,
    generation?: number,
  ): void {
    this.ensure(kind, id);
    this.db
      .prepare(
        `UPDATE cloud_objects SET revision=?,signature=?,confirmed=COALESCE(?,generation),
      pending=NULL,lastSyncedAt=? WHERE kind=? AND id=?`,
      )
      .run(revision, signature, generation ?? null, new Date().toISOString(), kind, id);
  }
  clearPending(kind: CloudObjectKind, id: string): void {
    this.db.prepare('UPDATE cloud_objects SET pending=NULL WHERE kind=? AND id=?').run(kind, id);
  }
  close(): void {
    this.db.close();
  }
}
