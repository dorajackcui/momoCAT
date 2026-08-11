import type Database from 'better-sqlite3';
import type { TMSyncChangedRow, TMSyncDiffSummary, TMSyncStagedRow } from '../types';

const TM_SYNC_INSERT_BATCH_SIZE = 500;
const TM_FTS_DELETE_BATCH_SIZE = 900;

interface TMFtsEntryMaintenance {
  deleteForEntry: (entryId: string) => void;
  insertForEntry: (tmId: string, srcText: string, tgtText: string, entryId: string) => void;
}

/**
 * Owns the incremental external-file sync workflow over tm_sync_staging.
 * Transaction boundaries remain with callers so staging and apply operations
 * can participate in the same atomic units as the surrounding service flow.
 */
export class TMSyncRepo {
  private stmtUpdateTarget?: Database.Statement;

  constructor(
    private readonly db: Database.Database,
    private readonly fts: TMFtsEntryMaintenance,
  ) {}

  public clearStagingForTM(tmId: string, exceptRunId?: string): void {
    if (exceptRunId) {
      this.db
        .prepare('DELETE FROM tm_sync_staging WHERE tmId = ? AND syncRunId != ?')
        .run(tmId, exceptRunId);
      return;
    }
    this.db.prepare('DELETE FROM tm_sync_staging WHERE tmId = ?').run(tmId);
  }

  public clearStagingRun(runId: string): void {
    this.db.prepare('DELETE FROM tm_sync_staging WHERE syncRunId = ?').run(runId);
  }

  // Must be called inside a transaction owned by the caller. INSERT OR REPLACE
  // on the (syncRunId, srcHash) primary key makes later file rows win when the
  // file contains duplicate sources. Rows arrive in file order and multi-row
  // VALUES preserves it, so REPLACE semantics are unchanged by batching.
  public stageRows(runId: string, tmId: string, rows: TMSyncStagedRow[]): void {
    for (let index = 0; index < rows.length; index += TM_SYNC_INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + TM_SYNC_INSERT_BATCH_SIZE);
      const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      this.db
        .prepare(
          `
          INSERT OR REPLACE INTO tm_sync_staging (
            tmId, syncRunId, srcHash, matchKey, tagsSignature,
            sourceTokensJson, targetTokensJson, srcText, tgtText
          ) VALUES ${values}
        `,
        )
        .run(
          ...batch.flatMap((row) => [
            tmId,
            runId,
            row.srcHash,
            row.matchKey,
            row.tagsSignature,
            row.sourceTokensJson,
            row.targetTokensJson,
            row.srcText,
            row.tgtText,
          ]),
        );
    }
  }

  public countStagedRows(runId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM tm_sync_staging WHERE syncRunId = ?')
      .get(runId) as { count: number };
    return row.count;
  }

  public getDiffSummary(runId: string, tmId: string, lastSyncedAt?: string): TMSyncDiffSummary {
    const added = (
      this.db
        .prepare(
          `
          SELECT COUNT(*) as count FROM tm_sync_staging s
          LEFT JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
          WHERE s.syncRunId = ? AND e.id IS NULL
        `,
        )
        .get(tmId, runId) as { count: number }
    ).count;

    const changed = (
      this.db
        .prepare(
          `
          SELECT COUNT(*) as count FROM tm_sync_staging s
          JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
          WHERE s.syncRunId = ?
            AND (e.targetTokensJson != s.targetTokensJson
              OR e.sourceTokensJson != s.sourceTokensJson)
        `,
        )
        .get(tmId, runId) as { count: number }
    ).count;

    const deleted = (
      this.db
        .prepare(
          `
          SELECT COUNT(*) as count FROM tm_entries e
          WHERE e.tmId = ?
            AND NOT EXISTS (
              SELECT 1 FROM tm_sync_staging s
              WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
            )
        `,
        )
        .get(tmId, runId) as { count: number }
    ).count;

    const overwrittenLocalEdits = lastSyncedAt
      ? (
          this.db
            .prepare(
              `
              SELECT COUNT(*) as count FROM tm_sync_staging s
              JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
              WHERE s.syncRunId = ?
                AND (e.targetTokensJson != s.targetTokensJson
                  OR e.sourceTokensJson != s.sourceTokensJson)
                AND e.updatedAt > ?
            `,
            )
            .get(tmId, runId, lastSyncedAt) as { count: number }
        ).count
      : 0;

    // Entries missing from the file whose local edits postdate the last full
    // sync: a prune-all run would silently destroy those edits, so they get
    // their own warning count.
    const deletedLocalEdits = lastSyncedAt
      ? (
          this.db
            .prepare(
              `
              SELECT COUNT(*) as count FROM tm_entries e
              WHERE e.tmId = ?
                AND NOT EXISTS (
                  SELECT 1 FROM tm_sync_staging s
                  WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
                )
                AND e.updatedAt > ?
            `,
            )
            .get(tmId, runId, lastSyncedAt) as { count: number }
        ).count
      : 0;

    return { added, changed, deleted, overwrittenLocalEdits, deletedLocalEdits };
  }

  // Keyset pagination keeps pages stable while the caller applies earlier
  // pages between calls: applied rows only disappear behind the cursor.
  public listNewRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncStagedRow[] {
    return this.db
      .prepare(
        `
        SELECT s.srcHash, s.matchKey, s.tagsSignature,
               s.sourceTokensJson, s.targetTokensJson, s.srcText, s.tgtText
        FROM tm_sync_staging s
        LEFT JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
        WHERE s.syncRunId = ? AND s.srcHash > ? AND e.id IS NULL
        ORDER BY s.srcHash ASC
        LIMIT ?
      `,
      )
      .all(tmId, runId, afterSrcHash, limit) as TMSyncStagedRow[];
  }

  public listChangedRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncChangedRow[] {
    return this.db
      .prepare(
        `
        SELECT s.srcHash, s.matchKey, s.tagsSignature,
               s.sourceTokensJson, s.targetTokensJson, s.srcText, s.tgtText,
               e.id AS entryId
        FROM tm_sync_staging s
        JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
        WHERE s.syncRunId = ? AND s.srcHash > ?
          AND (e.targetTokensJson != s.targetTokensJson
            OR e.sourceTokensJson != s.sourceTokensJson)
        ORDER BY s.srcHash ASC
        LIMIT ?
      `,
      )
      .all(tmId, runId, afterSrcHash, limit) as TMSyncChangedRow[];
  }

  public listDeletedEntries(
    runId: string,
    tmId: string,
    afterId: string,
    limit: number,
  ): Array<{ id: string }> {
    return this.db
      .prepare(
        `
        SELECT e.id FROM tm_entries e
        WHERE e.tmId = ? AND e.id > ?
          AND NOT EXISTS (
            SELECT 1 FROM tm_sync_staging s
            WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
          )
        ORDER BY e.id ASC
        LIMIT ?
      `,
      )
      .all(tmId, afterId, runId, limit) as Array<{ id: string }>;
  }

  // Must be called inside a transaction owned by the caller. Entry and FTS
  // rows are written as a pair so a rollback never leaves a dangling FTS row.
  public applyInserts(tmId: string, rows: Array<TMSyncStagedRow & { id: string }>): number {
    let inserted = 0;
    for (let index = 0; index < rows.length; index += TM_SYNC_INSERT_BATCH_SIZE) {
      inserted += this.applyInsertBatch(tmId, rows.slice(index, index + TM_SYNC_INSERT_BATCH_SIZE));
    }
    return inserted;
  }

  private applyInsertBatch(tmId: string, rows: Array<TMSyncStagedRow & { id: string }>): number {
    if (rows.length === 0) return 0;

    const entryValues = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, NULL, 0)').join(', ');
    const insertedRows = this.db
      .prepare(
        `
        INSERT INTO tm_entries (
          id, tmId, srcHash, matchKey, tagsSignature,
          sourceTokensJson, targetTokensJson, originSegmentId, usageCount
        ) VALUES ${entryValues}
        ON CONFLICT(tmId, srcHash) DO NOTHING
        RETURNING id
      `,
      )
      .all(
        ...rows.flatMap((row) => [
          row.id,
          tmId,
          row.srcHash,
          row.matchKey,
          row.tagsSignature,
          row.sourceTokensJson,
          row.targetTokensJson,
        ]),
      ) as Array<{ id: string }>;
    if (insertedRows.length === 0) return 0;

    // RETURNING row order is unspecified; filter the input by inserted id.
    const insertedIds = new Set(insertedRows.map((row) => row.id));
    const inserted = rows.filter((row) => insertedIds.has(row.id));

    const baseRowid = (
      this.db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM tm_fts').get() as { m: number }
    ).m;
    const ftsValues = inserted.map(() => '(?, ?, ?, ?, ?)').join(', ');
    this.db
      .prepare(`INSERT INTO tm_fts (rowid, tmId, srcText, tgtText, tmEntryId) VALUES ${ftsValues}`)
      .run(
        ...inserted.flatMap((row, offset) => [
          baseRowid + 1 + offset,
          tmId,
          row.srcText,
          row.tgtText,
          row.id,
        ]),
      );

    const mappingValues = inserted.map(() => '(?, ?)').join(', ');
    this.db
      .prepare(
        `
        WITH v(rid, eid) AS (VALUES ${mappingValues})
        UPDATE tm_entries SET ftsRowid = v.rid FROM v WHERE tm_entries.id = v.eid
      `,
      )
      .run(...inserted.flatMap((row, offset) => [baseRowid + 1 + offset, row.id]));

    return inserted.length;
  }

  // Sync updates refresh display tokens while preserving usage metadata.
  public applyUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number {
    this.stmtUpdateTarget ??= this.db.prepare(`
      UPDATE tm_entries
      SET sourceTokensJson = ?, targetTokensJson = ?,
          updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `);

    let updated = 0;
    for (const row of rows) {
      const result = this.stmtUpdateTarget.run(
        row.sourceTokensJson,
        row.targetTokensJson,
        row.entryId,
      );
      if (result.changes === 0) continue;

      this.fts.deleteForEntry(row.entryId);
      this.fts.insertForEntry(tmId, row.srcText, row.tgtText, row.entryId);
      updated += 1;
    }
    return updated;
  }

  // FTS rows go first because their rowid mapping lives on the entry row.
  public deleteEntriesWithFts(entryIds: string[]): number {
    let deleted = 0;
    for (let index = 0; index < entryIds.length; index += TM_FTS_DELETE_BATCH_SIZE) {
      const batch = entryIds.slice(index, index + TM_FTS_DELETE_BATCH_SIZE);
      for (const entryId of batch) {
        this.fts.deleteForEntry(entryId);
      }
      const placeholders = batch.map(() => '?').join(',');
      const result = this.db
        .prepare(`DELETE FROM tm_entries WHERE id IN (${placeholders})`)
        .run(...batch);
      deleted += result.changes;
    }
    return deleted;
  }
}
