import type Database from 'better-sqlite3';
import type { TMEntry, Token } from '@cat/core/models';
import type { TMEntryRow } from '../../types';
import { mapTMEntryDbRow, type TMEntryDbRow, type TMFtsReplacementRow } from './tmEntryRows';

// FTS5 incremental merge: pages written per 'merge' step, and the max steps
// one optimizeTMFts call may run. 16 pages/step keeps each step a few ms;
// 64 rounds bounds a single call to ~1k pages of work regardless of how
// fragmented the index is (leftovers roll over to the next call).
const TM_FTS_MERGE_STEP_PAGES = 16;
const TM_FTS_MERGE_MAX_ROUNDS = 64;

/** Internal entry and FTS storage; public persistence callers use TMRepo. */
export class TMEntryRepo {
  private stmtUpsertTMEntry: Database.Statement;
  private stmtInsertTMEntryIfAbsentBySrcHash: Database.Statement;
  private stmtUpsertTMEntryBySrcHash: Database.Statement;
  private stmtDeleteTMFtsByEntryId: Database.Statement;
  private stmtInsertTMFts: Database.Statement;
  private stmtFindTMEntryByHash: Database.Statement;
  private stmtFindTMEntryMetaByHash: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtUpsertTMEntry = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        targetTokensJson = excluded.targetTokensJson,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = usageCount + 1
    `);

    this.stmtInsertTMEntryIfAbsentBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO NOTHING
      RETURNING id
    `);

    this.stmtUpsertTMEntryBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO UPDATE SET
        matchKey = excluded.matchKey,
        tagsSignature = excluded.tagsSignature,
        sourceTokensJson = excluded.sourceTokensJson,
        targetTokensJson = excluded.targetTokensJson,
        originSegmentId = excluded.originSegmentId,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = tm_entries.usageCount + 1
      RETURNING id
    `);

    this.stmtDeleteTMFtsByEntryId = this.db.prepare('DELETE FROM tm_fts WHERE tmEntryId = ?');
    this.stmtInsertTMFts = this.db.prepare(
      'INSERT INTO tm_fts (tmId, srcText, tgtText, tmEntryId) VALUES (?, ?, ?, ?)',
    );
    this.stmtFindTMEntryByHash = this.db.prepare(
      'SELECT * FROM tm_entries WHERE tmId = ? AND srcHash = ?',
    );
    this.stmtFindTMEntryMetaByHash = this.db.prepare(
      'SELECT id, usageCount, createdAt FROM tm_entries WHERE tmId = ? AND srcHash = ?',
    );
  }

  // --- tm_fts row bookkeeping ---
  //
  // tmEntryId is UNINDEXED in the FTS5 table, so deleting by it scans every
  // document. tm_entries.ftsRowid remembers each entry's FTS rowid so
  // replace/delete paths are O(log n) instead. Prepared lazily: ftsRowid is an
  // additive column created by schema maintenance, which readonly connections
  // skip.
  private stmtGetTMEntryFtsRowid?: Database.Statement;
  private stmtSetTMEntryFtsRowid?: Database.Statement;
  private stmtDeleteTMFtsByRowid?: Database.Statement;

  public insertTMFtsForEntry(
    tmId: string,
    srcText: string,
    tgtText: string,
    tmEntryId: string,
  ): void {
    const info = this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
    this.stmtSetTMEntryFtsRowid ??= this.db.prepare(
      'UPDATE tm_entries SET ftsRowid = ? WHERE id = ?',
    );
    this.stmtSetTMEntryFtsRowid.run(info.lastInsertRowid, tmEntryId);
  }

  public deleteTMFtsForEntry(tmEntryId: string): void {
    this.stmtGetTMEntryFtsRowid ??= this.db.prepare('SELECT ftsRowid FROM tm_entries WHERE id = ?');
    const row = this.stmtGetTMEntryFtsRowid.get(tmEntryId) as
      | { ftsRowid: number | null }
      | undefined;
    // NULL/0: no FTS row recorded for this entry (fresh insert, or an entry
    // that never had one) — nothing to delete.
    if (!row?.ftsRowid) return;

    this.stmtDeleteTMFtsByRowid ??= this.db.prepare(
      'DELETE FROM tm_fts WHERE rowid = ? AND tmEntryId = ?',
    );
    const result = this.stmtDeleteTMFtsByRowid.run(row.ftsRowid, tmEntryId);
    if (result.changes === 0) {
      // Stale mapping (e.g. the row was rewritten by an app version that
      // predates ftsRowid): fall back to the full-scan delete.
      this.stmtDeleteTMFtsByEntryId.run(tmEntryId);
    }
  }

  public upsertTMEntry(entry: TMEntry & { tmId: string }) {
    this.db.transaction(() => {
      this.stmtUpsertTMEntry.run(
        entry.id,
        entry.tmId,
        entry.srcHash,
        entry.matchKey,
        entry.tagsSignature,
        JSON.stringify(entry.sourceTokens),
        JSON.stringify(entry.targetTokens),
        entry.originSegmentId,
        entry.usageCount,
      );

      const srcText = entry.sourceTokens.map((token: Token) => token.content).join('');
      const tgtText = entry.targetTokens.map((token: Token) => token.content).join('');

      this.deleteTMFtsForEntry(entry.id);
      this.insertTMFtsForEntry(entry.tmId, srcText, tgtText, entry.id);
    })();
  }

  public insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined {
    const row = this.stmtInsertTMEntryIfAbsentBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount,
    ) as { id: string } | undefined;

    return row?.id;
  }

  public upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    const row = this.stmtUpsertTMEntryBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount,
    ) as { id: string } | undefined;

    if (!row?.id) {
      throw new Error('Failed to upsert TM entry by srcHash');
    }

    return row.id;
  }

  public insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.insertTMFtsForEntry(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.replaceTMFtsBatch([{ tmId, srcText, tgtText, tmEntryId }]);
  }

  public replaceTMFtsBatch(rows: TMFtsReplacementRow[]) {
    const replacements = this.dedupeTMFtsReplacementRows(rows);
    if (replacements.length === 0) return;

    const replaceRows = () => {
      for (const row of replacements) {
        this.deleteTMFtsForEntry(row.tmEntryId);
        this.insertTMFtsForEntry(row.tmId, row.srcText, row.tgtText, row.tmEntryId);
      }
    };

    if (this.db.inTransaction) {
      replaceRows();
      return;
    }

    this.db.transaction(replaceRows)();
  }

  public findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    const row = this.stmtFindTMEntryByHash.get(tmId, srcHash) as TMEntryDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson),
    };
  }

  public findTMEntryMetaByHash(
    tmId: string,
    srcHash: string,
  ): { id: string; usageCount: number; createdAt: string } | undefined {
    const row = this.stmtFindTMEntryMetaByHash.get(tmId, srcHash) as
      | { id: string; usageCount: number; createdAt: string }
      | undefined;
    return row;
  }

  private dedupeTMFtsReplacementRows(rows: TMFtsReplacementRow[]): TMFtsReplacementRow[] {
    const byEntryId = new Map<string, TMFtsReplacementRow>();
    for (const row of rows) {
      byEntryId.set(row.tmEntryId, row);
    }
    return Array.from(byEntryId.values());
  }

  public listTMEntries(tmId: string, limit: number = 500, offset: number = 0): TMEntryRow[] {
    const rows = this.db
      .prepare(
        `
      SELECT *
      FROM tm_entries
      WHERE tmId = ?
      ORDER BY updatedAt DESC, id ASC
      LIMIT ? OFFSET ?
    `,
      )
      .all(tmId, limit, offset) as TMEntryDbRow[];

    return rows.map((row) => mapTMEntryDbRow(row));
  }

  public clearTMEntries(tmId: string): number {
    const clearRows = () => {
      this.db
        .prepare(
          'DELETE FROM tm_fts WHERE tmId = ? OR tmEntryId IN (SELECT id FROM tm_entries WHERE tmId = ?)',
        )
        .run(tmId, tmId);
      return this.db.prepare('DELETE FROM tm_entries WHERE tmId = ?').run(tmId).changes;
    };

    return this.db.inTransaction ? clearRows() : this.db.transaction(clearRows)();
  }

  // Incremental FTS maintenance with bounded cost per call. A full
  // 'optimize' rewrites the whole tm_fts index, so its latency grows with
  // TOTAL entries across all TMs (~9s at 460k entries) even when the sync
  // touched far fewer rows.
  //
  // FTS5 'merge' semantics (per docs): a POSITIVE step continues a merge
  // already underway (or starts one only among >= usermerge same-level
  // segments); a NEGATIVE step starts a merge of ALL segments but RESTARTS
  // from scratch on every call. So: probe with one positive step first —
  // if it did real work, a merge was underway (or same-level segments were
  // consolidated) and we just continue stepping. Only when the probe is a
  // no-op (nothing underway, nothing same-level) kick off ONE negative
  // merge-all and step that. Work not finished within the round budget is
  // resumed — not repeated — by the next call's positive probe.
  public optimizeTMFts(): void {
    this.db.prepare(`INSERT INTO tm_fts(tm_fts, rank) VALUES('usermerge', 2)`).run();
    const stmtMerge = this.db.prepare(`INSERT INTO tm_fts(tm_fts, rank) VALUES('merge', ?)`);
    const stmtChanges = this.db.prepare('SELECT total_changes() AS c');
    const readChanges = () => (stmtChanges.get() as { c: number }).c;
    // Per the FTS5 docs, a merge step that modifies fewer than 2 rows did
    // no real work.
    const step = (pages: number): boolean => {
      const before = readChanges();
      stmtMerge.run(pages);
      return readChanges() - before >= 2;
    };

    if (!step(TM_FTS_MERGE_STEP_PAGES)) {
      if (!step(-TM_FTS_MERGE_STEP_PAGES)) return;
    }
    for (let round = 0; round < TM_FTS_MERGE_MAX_ROUNDS; round++) {
      if (!step(TM_FTS_MERGE_STEP_PAGES)) break;
    }
  }
}
