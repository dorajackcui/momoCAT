import Database from 'better-sqlite3';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { ensureCurrentSchema } from '../currentSchema';
import { invalidateTermBaseQA } from '../repos/qaInvalidation';
import {
  columns,
  type Row,
  type Table,
  type CloudProjectRecordV2,
  type CloudSegmentRecordV2,
  type CloudTMRecordV2,
  type CloudTBRecordV2,
  type CloudTMEntryV2,
  type ProjectSnapshotV2,
  type ResourceSnapshotV2,
  type CloudSnapshotAfterRestore,
} from './CloudAccountSnapshotFormat';
import { tokens, validateProject, validateResource } from './CloudAccountSnapshotValidation';
import { recordCloudInstallReceipt } from './CloudAccountInstallReceipt';

// Internal SQL owner. Public callers use the CloudAccountSnapshot facade.
export function open(dbPath: string, readonly = false): Database.Database {
  const db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : {});
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    ensureCurrentSchema(db, { allowSchemaMaintenance: !readonly });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function read<T>(db: Database.Database, table: Table, condition: string, id: string | number): T[] {
  return db
    .prepare(`SELECT ${columns[table]} FROM ${table} WHERE ${condition} ORDER BY rowid`)
    .all(id) as T[];
}

export function exportProject(db: Database.Database, projectId: number): ProjectSnapshotV2 {
  const project = read<CloudProjectRecordV2>(db, 'projects', 'id = ?', projectId)[0];
  if (!project) throw new Error('Project not found');
  const working = db
    .prepare(
      `SELECT ${columns.tms
        .split(',')
        .map((key) => `t.${key}`)
        .join(',')}
    FROM tms t JOIN project_tms p ON p.tmId = t.id WHERE p.projectId = ? AND t.type = 'working' ORDER BY t.rowid`,
    )
    .all(projectId) as CloudTMRecordV2[];
  if (working.length > 1) throw new Error('Cloud project must have at most one Working TM');
  if (
    working[0] &&
    db
      .prepare('SELECT 1 FROM project_tms WHERE tmId = ? AND projectId != ?')
      .get(working[0].id, projectId)
  )
    throw new Error('Working TM belongs to another project');
  const snapshot: ProjectSnapshotV2 = {
    protocol: 2,
    sourceSQLite: 15,
    kind: 'project',
    project,
    files: read(db, 'files', 'projectId = ?', projectId),
    segments: db
      .prepare(
        `SELECT ${columns.segments
          .split(',')
          .map((key) => `s.${key}`)
          .join(',')},f.uuid AS fileUUID
      FROM segments s JOIN files f ON f.id = s.fileId WHERE f.projectId = ? ORDER BY s.rowid`,
      )
      .all(projectId) as CloudSegmentRecordV2[],
    prompts: read(db, 'project_prompts', 'projectId = ?', projectId),
    workingTM: working[0]
      ? { resource: working[0], entries: read(db, 'tm_entries', 'tmId = ?', working[0].id) }
      : null,
    mounts: {
      tms: read(db, 'project_tms', 'projectId = ?', projectId),
      tbs: read(db, 'project_term_bases', 'projectId = ?', projectId),
    },
  };
  return validateProject(snapshot);
}

export function exportCloudAccountProject(dbPath: string, projectId: number): ProjectSnapshotV2 {
  const db = open(dbPath, true);
  try {
    return db.transaction(() => exportProject(db, projectId))();
  } finally {
    db.close();
  }
}

export function exportResource(
  db: Database.Database,
  kind: 'tm' | 'tb',
  id: string,
): ResourceSnapshotV2 {
  const resource = read<CloudTMRecordV2 | CloudTBRecordV2>(
    db,
    kind === 'tm' ? 'tms' : 'term_bases',
    'id = ?',
    id,
  )[0];
  if (!resource) throw new Error('Resource not found');
  return validateResource({
    protocol: 2,
    sourceSQLite: 15,
    kind,
    resource,
    entries: read(db, kind === 'tm' ? 'tm_entries' : 'tb_entries', `${kind}Id = ?`, id),
  });
}

export function exportCloudResource(
  dbPath: string,
  kind: 'tm' | 'tb',
  id: string,
): ResourceSnapshotV2 {
  const db = open(dbPath, true);
  try {
    return db.transaction(() => exportResource(db, kind, id))();
  } finally {
    db.close();
  }
}

function insert(db: Database.Database, table: Table, row: object, additional: Row = {}): void {
  const values = { ...row, ...additional } as Row;
  const keys = [
    ...columns[table].split(','),
    ...Object.keys(additional).filter((key) => !columns[table].split(',').includes(key)),
  ];
  db.prepare(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
  ).run(...keys.map((key) => values[key]));
}
function update(
  db: Database.Database,
  table: Table,
  row: object,
  key: 'id' | 'uuid',
  id: string | number,
): void {
  const values = row as Row;
  const keys = columns[table].split(',').filter((column) => column !== key);
  db.prepare(
    `UPDATE ${table} SET ${keys.map((column) => `${column} = ?`).join(',')} WHERE ${key} = ?`,
  ).run(...keys.map((column) => values[column]), id);
}
function checkEntryCollisions(
  db: Database.Database,
  table: 'tm_entries' | 'tb_entries',
  owner: string,
  rows: { id: string }[],
): void {
  const ownerColumn = table === 'tm_entries' ? 'tmId' : 'tbId';
  const statement = db.prepare(`SELECT ${ownerColumn} AS owner FROM ${table} WHERE id = ?`);
  for (const row of rows) {
    const existing = statement.get(row.id) as { owner: string } | undefined;
    if (existing && existing.owner !== owner)
      throw new Error('Snapshot entry identity belongs to another resource');
  }
}
function replaceTM(
  db: Database.Database,
  resource: CloudTMRecordV2,
  entries: CloudTMEntryV2[],
): void {
  const existing = db.prepare('SELECT type FROM tms WHERE id = ?').get(resource.id) as
    | { type: string }
    | undefined;
  if (existing && existing.type !== resource.type)
    throw new Error('Snapshot resource identity type mismatch');
  checkEntryCollisions(db, 'tm_entries', resource.id, entries);
  if (existing) update(db, 'tms', resource, 'id', resource.id);
  else insert(db, 'tms', resource);
  db.prepare('DELETE FROM tm_fts WHERE tmId = ?').run(resource.id);
  db.prepare('DELETE FROM tm_entries WHERE tmId = ?').run(resource.id);
  const fts = db.prepare('INSERT INTO tm_fts (tmId,srcText,tgtText,tmEntryId) VALUES (?,?,?,?)');
  const mapping = db.prepare('UPDATE tm_entries SET ftsRowid = ? WHERE id = ?');
  for (const entry of entries) {
    insert(db, 'tm_entries', entry);
    const info = fts.run(
      resource.id,
      serializeTokensToDisplayText(tokens(entry.sourceTokensJson)),
      serializeTokensToDisplayText(tokens(entry.targetTokensJson)),
      entry.id,
    );
    mapping.run(info.lastInsertRowid, entry.id);
  }
}
export function restoreResource(db: Database.Database, snapshot: ResourceSnapshotV2): string {
  if (snapshot.kind === 'tm') {
    replaceTM(db, snapshot.resource, snapshot.entries);
    return snapshot.resource.id;
  }
  const { resource, entries } = snapshot;
  checkEntryCollisions(db, 'tb_entries', resource.id, entries);
  if (db.prepare('SELECT 1 FROM term_bases WHERE id = ?').get(resource.id))
    update(db, 'term_bases', resource, 'id', resource.id);
  else insert(db, 'term_bases', resource);
  db.prepare('DELETE FROM tb_fts WHERE tbId = ?').run(resource.id);
  db.prepare('DELETE FROM tb_entries WHERE tbId = ?').run(resource.id);
  const fts = db.prepare('INSERT INTO tb_fts (tbId,srcText,tbEntryId) VALUES (?,?,?)');
  const mapping = db.prepare('UPDATE tb_entries SET ftsRowid = ? WHERE id = ?');
  for (const entry of entries) {
    insert(db, 'tb_entries', entry);
    // srcNorm is authoritative and already uses the TB writer's locale rules.
    // Recomputing it during transfer would change old-v15 matching/uniqueness.
    const info = fts.run(resource.id, entry.srcNorm, entry.id);
    mapping.run(info.lastInsertRowid, entry.id);
  }
  invalidateTermBaseQA(db, resource.id);
  return resource.id;
}
export function restoreCloudResource(dbPath: string, input: unknown): string {
  const snapshot = validateResource(input);
  const db = open(dbPath);
  try {
    return db.transaction(() => restoreResource(db, snapshot))();
  } finally {
    db.close();
  }
}

export function restoreProject(db: Database.Database, snapshot: ProjectSnapshotV2): number {
  const existing = db
    .prepare('SELECT id FROM projects WHERE uuid = ?')
    .get(snapshot.project.uuid) as { id: number } | undefined;
  const workingId = snapshot.workingTM?.resource.id;
  for (const mount of snapshot.mounts.tms) {
    const resource = db.prepare('SELECT type FROM tms WHERE id = ?').get(mount.tmId) as
      | { type: string }
      | undefined;
    if (mount.tmId === workingId) {
      if (resource && resource.type !== 'working')
        throw new Error('Working TM identity type mismatch');
      if (
        db
          .prepare('SELECT 1 FROM project_tms WHERE tmId = ? AND projectId != ?')
          .get(mount.tmId, existing?.id ?? -1)
      )
        throw new Error('Working TM belongs to another project');
      // An unmounted Working TM is not claimed through an incoming identity.
      if (
        resource &&
        !db
          .prepare('SELECT 1 FROM project_tms WHERE tmId = ? AND projectId = ?')
          .get(mount.tmId, existing?.id ?? -1)
      )
        throw new Error('Working TM identity belongs to another project');
    } else if (!resource || resource.type !== 'main') throw new Error('Referenced Main TM missing');
  }
  for (const mount of snapshot.mounts.tbs) {
    if (!db.prepare('SELECT 1 FROM term_bases WHERE id = ?').get(mount.tbId))
      throw new Error('Referenced TB missing');
  }
  const fileOwners = db.prepare('SELECT projectId FROM files WHERE uuid = ?');
  for (const file of snapshot.files) {
    const owner = fileOwners.get(file.uuid) as { projectId: number } | undefined;
    if (owner && owner.projectId !== existing?.id)
      throw new Error('Snapshot file identity belongs to another project');
  }
  const segmentOwners = db.prepare(
    'SELECT f.projectId FROM segments s JOIN files f ON f.id = s.fileId WHERE s.segmentId = ?',
  );
  for (const segment of snapshot.segments) {
    const owner = segmentOwners.get(segment.segmentId) as { projectId: number } | undefined;
    if (owner && owner.projectId !== existing?.id)
      throw new Error('Snapshot segment identity belongs to another project');
  }
  if (snapshot.workingTM)
    checkEntryCollisions(
      db,
      'tm_entries',
      snapshot.workingTM.resource.id,
      snapshot.workingTM.entries,
    );
  const previousWorking = existing
    ? (db
        .prepare(
          `SELECT t.id FROM tms t JOIN project_tms p ON p.tmId = t.id WHERE p.projectId = ? AND t.type = 'working'`,
        )
        .all(existing.id) as { id: string }[])
    : [];
  if (existing) update(db, 'projects', snapshot.project, 'uuid', snapshot.project.uuid);
  else insert(db, 'projects', snapshot.project);
  const projectId = (
    db.prepare('SELECT id FROM projects WHERE uuid = ?').get(snapshot.project.uuid) as {
      id: number;
    }
  ).id;
  // Matching UUIDs retain their device-local IDs; different devices allocate
  // independently. No incoming integer can overwrite another account object.
  const previousFiles = db
    .prepare('SELECT id,uuid FROM files WHERE projectId = ?')
    .all(projectId) as { id: number; uuid: string }[];
  const previousByUUID = new Map(previousFiles.map((file) => [file.uuid, file.id]));
  const nextUUIDs = new Set(snapshot.files.map((file) => file.uuid));
  db.prepare('DELETE FROM segments WHERE fileId IN (SELECT id FROM files WHERE projectId = ?)').run(
    projectId,
  );
  for (const file of previousFiles)
    if (!nextUUIDs.has(file.uuid)) db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  const fileIds = new Map<string, number>();
  for (const file of snapshot.files) {
    if (previousByUUID.has(file.uuid)) update(db, 'files', file, 'uuid', file.uuid);
    else insert(db, 'files', file, { projectId });
    fileIds.set(
      file.uuid,
      (db.prepare('SELECT id FROM files WHERE uuid = ?').get(file.uuid) as { id: number }).id,
    );
  }
  for (const segment of snapshot.segments) {
    const { fileUUID, ...row } = segment;
    insert(db, 'segments', row, { fileId: fileIds.get(fileUUID)! });
  }
  const previousPrompts = db
    .prepare('SELECT id,name FROM project_prompts WHERE projectId = ?')
    .all(projectId) as { id: number; name: string }[];
  const promptIds = new Map(previousPrompts.map((prompt) => [prompt.name, prompt.id]));
  const promptNames = new Set(snapshot.prompts.map((prompt) => prompt.name));
  for (const prompt of previousPrompts)
    if (!promptNames.has(prompt.name))
      db.prepare('DELETE FROM project_prompts WHERE id = ?').run(prompt.id);
  for (const prompt of snapshot.prompts) {
    const id = promptIds.get(prompt.name);
    if (id) update(db, 'project_prompts', prompt, 'id', id);
    else insert(db, 'project_prompts', prompt, { projectId });
  }
  db.prepare('DELETE FROM project_tms WHERE projectId = ?').run(projectId);
  db.prepare('DELETE FROM project_term_bases WHERE projectId = ?').run(projectId);
  if (snapshot.workingTM) replaceTM(db, snapshot.workingTM.resource, snapshot.workingTM.entries);
  for (const mount of snapshot.mounts.tms) insert(db, 'project_tms', mount, { projectId });
  for (const mount of snapshot.mounts.tbs) insert(db, 'project_term_bases', mount, { projectId });
  for (const resource of previousWorking) {
    if (
      resource.id !== workingId &&
      !db.prepare('SELECT 1 FROM project_tms WHERE tmId = ?').get(resource.id)
    ) {
      db.prepare('DELETE FROM tm_fts WHERE tmId = ?').run(resource.id);
      db.prepare('DELETE FROM tms WHERE id = ?').run(resource.id);
    }
  }
  return projectId;
}
export function finishRestore(
  db: Database.Database,
  projectId: number,
  afterRestore?: CloudSnapshotAfterRestore,
  sourceUUIDs?: ReadonlyMap<string, string>,
): number {
  if (afterRestore) {
    const files = db
      .prepare('SELECT id,uuid,name,projectId FROM files WHERE projectId = ? ORDER BY id')
      .all(projectId) as Parameters<CloudSnapshotAfterRestore>[1];
    if (sourceUUIDs) for (const file of files) file.sourceUUID = sourceUUIDs.get(file.uuid);
    const receipt = afterRestore(projectId, files);
    if (receipt !== undefined) recordCloudInstallReceipt(db, receipt.installationId, projectId);
  }
  return projectId;
}
export function restoreCloudAccountProject(
  dbPath: string,
  input: unknown,
  afterRestore?: CloudSnapshotAfterRestore,
): number {
  const snapshot = validateProject(input);
  const db = open(dbPath);
  try {
    // Filesystem installations may discard their rollback journal only after
    // this transaction's receipt is durable, including across a power loss.
    if (afterRestore) db.pragma('synchronous = FULL');
    return db.transaction(() => finishRestore(db, restoreProject(db, snapshot), afterRestore))();
  } finally {
    db.close();
  }
}
