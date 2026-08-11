import type Database from 'better-sqlite3';

const CLEAR_BATCH_SIZE = 500;

interface ResetEntryRow {
  id: string;
}

interface FtsRow {
  ftsRowid: number;
}

export function clearTMEntriesInBatches(
  db: Database.Database,
  tmId: string,
  deleteEntriesWithFts: (entryIds: string[]) => number,
): number {
  if (db.inTransaction) {
    throw new Error('clearTMEntries must own its bounded transactions.');
  }

  const listEntries = db.prepare(`
    SELECT id
    FROM tm_entries
    WHERE tmId = ?
    ORDER BY rowid ASC
    LIMIT ?
  `);

  let removed = 0;
  let rows = listEntries.all(tmId, CLEAR_BATCH_SIZE) as ResetEntryRow[];
  while (rows.length > 0) {
    removed += db.transaction(() => deleteEntriesWithFts(rows.map((row) => row.id)))();
    rows = listEntries.all(tmId, CLEAR_BATCH_SIZE) as ResetEntryRow[];
  }

  removeOrphanFtsRowsInBatches(db, tmId);
  return removed;
}

function removeOrphanFtsRowsInBatches(db: Database.Database, tmId: string): void {
  const listOrphans = db.prepare(`
    SELECT rowid AS ftsRowid
    FROM tm_fts
    WHERE tmId = ?
      AND NOT EXISTS (
        SELECT 1
        FROM tm_entries
        WHERE tm_entries.id = tm_fts.tmEntryId
          AND tm_entries.tmId = tm_fts.tmId
      )
    ORDER BY rowid ASC
    LIMIT ?
  `);

  let rows = listOrphans.all(tmId, CLEAR_BATCH_SIZE) as FtsRow[];
  while (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    db.transaction(() => {
      db.prepare(`DELETE FROM tm_fts WHERE rowid IN (${placeholders})`).run(
        ...rows.map((row) => row.ftsRowid),
      );
    })();
    rows = listOrphans.all(tmId, CLEAR_BATCH_SIZE) as FtsRow[];
  }
}
