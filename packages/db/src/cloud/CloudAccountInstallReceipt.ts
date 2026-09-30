import Database from 'better-sqlite3';

export interface CloudInstallReceipt {
  id: string;
  projectUUID: string;
  generation: number;
  acknowledged: number;
}

function requireInstallationId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new Error('Invalid cloud installation identity');
}

/** Installed only in the isolated account cache by the filesystem installer. */
export function initializeCloudInstallReceipts(dbPath: string): void {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const marker = db.prepare('SELECT version FROM cloud_cache_format').all() as {
      version: number;
    }[];
    if (marker.length !== 1 || marker[0].version !== 2)
      throw new Error('Cloud installation receipts require an account cache');
    db.exec(`CREATE TABLE IF NOT EXISTS cloud_install_receipts (
      id TEXT PRIMARY KEY, projectUUID TEXT NOT NULL, generation INTEGER NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    )`);
    const columns = db.prepare('PRAGMA table_info(cloud_install_receipts)').all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'acknowledged'))
      db.exec(
        'ALTER TABLE cloud_install_receipts ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0',
      );
  } finally {
    db.close();
  }
}

// Called by the snapshot SQL owner before its transaction commits. The receipt
// and imported project can therefore never disagree after SQLite recovery.
export function recordCloudInstallReceipt(
  db: Database.Database,
  id: string,
  projectId: number,
): void {
  requireInstallationId(id);
  db.prepare(
    `INSERT INTO cloud_install_receipts(id,projectUUID,generation)
    SELECT ?,p.uuid,o.generation FROM projects p JOIN cloud_objects o ON o.kind='project' AND o.id=p.uuid
    WHERE p.id=?`,
  ).run(id, projectId);
  if (!db.prepare('SELECT 1 FROM cloud_install_receipts WHERE id=?').get(id))
    throw new Error('Cloud installation project is not tracked');
}

export function getCloudInstallReceipt(
  dbPath: string,
  id: string,
): CloudInstallReceipt | undefined {
  requireInstallationId(id);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cloud_install_receipts'")
        .get()
    )
      return undefined;
    return db
      .prepare(
        'SELECT id,projectUUID,generation,acknowledged FROM cloud_install_receipts WHERE id=?',
      )
      .get(id) as CloudInstallReceipt | undefined;
  } finally {
    db.close();
  }
}

/** The install acknowledgement and its durable phase commit together. */
export function acknowledgeCloudInstallReceipt(
  dbPath: string,
  id: string,
  revision: number,
  signature: string,
): void {
  requireInstallationId(id);
  if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(signature))
    throw new Error('Invalid cloud installation acknowledgement');
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = FULL');
    db.transaction(() => {
      const receipt = db.prepare('SELECT * FROM cloud_install_receipts WHERE id=?').get(id) as
        | CloudInstallReceipt
        | undefined;
      if (!receipt) throw new Error('Cloud installation receipt missing');
      if (receipt.acknowledged) return;
      const row = db
        .prepare("SELECT revision,pending FROM cloud_objects WHERE kind='project' AND id=?")
        .get(receipt.projectUUID) as { revision: number; pending: string | null } | undefined;
      if (!row) throw new Error('Cloud installation project is not tracked');
      if (row.revision <= revision) {
        // A failed acknowledgement may be followed by a new edit or upload
        // attempt. Confirm only the generation imported by this installation.
        let clearPending = row.pending === null;
        if (row.pending) {
          try {
            clearPending = JSON.parse(row.pending).generation <= receipt.generation;
          } catch {
            clearPending = false;
          }
        }
        db.prepare(
          `UPDATE cloud_objects SET revision=?,signature=?,confirmed=?,
          pending=CASE WHEN ? THEN NULL ELSE pending END,lastSyncedAt=?
          WHERE kind='project' AND id=?`,
        ).run(
          revision,
          signature,
          receipt.generation,
          Number(clearPending),
          new Date().toISOString(),
          receipt.projectUUID,
        );
      }
      db.prepare('UPDATE cloud_install_receipts SET acknowledged=1 WHERE id=?').run(id);
    })();
  } finally {
    db.close();
  }
}

export function clearCloudInstallReceipt(dbPath: string, id: string): void {
  requireInstallationId(id);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare('DELETE FROM cloud_install_receipts WHERE id=?').run(id);
  } finally {
    db.close();
  }
}
