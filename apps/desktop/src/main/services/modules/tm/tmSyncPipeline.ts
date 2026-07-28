import { randomUUID } from 'crypto';
import { parseDisplayTextToTokens, computeTagsSignature } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import { extractSheetRows, readFirstSheet } from '../../../filters/sheetRows';
import type { TMSyncColumns, TMSyncDeletePolicy, TMSyncReport } from '../../../../shared/ipc';

export interface TMSyncStagedRow {
  srcHash: string;
  matchKey: string;
  tagsSignature: string;
  sourceTokensJson: string;
  targetTokensJson: string;
  srcText: string;
  tgtText: string;
}

// Subset of CATDatabase the pipeline needs; lets tests run it in-process
// against a temp database instead of spawning the worker.
export interface TMSyncDatabasePort {
  getTM(tmId: string): { id: string } | undefined;
  runInTransaction<T>(fn: () => T): T;
  clearTMSyncStagingForTM(tmId: string, exceptRunId?: string): void;
  clearTMSyncStagingRun(runId: string): void;
  stageTMSyncRows(runId: string, tmId: string, rows: TMSyncStagedRow[]): void;
  countTMSyncStagedRows(runId: string): number;
  getTMSyncDiffSummary(
    runId: string,
    tmId: string,
    lastSyncedAt?: string,
  ): {
    added: number;
    changed: number;
    deleted: number;
    overwrittenLocalEdits: number;
    deletedLocalEdits: number;
  };
  listTMSyncNewRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncStagedRow[];
  listTMSyncChangedRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): Array<TMSyncStagedRow & { entryId: string }>;
  listTMSyncDeletedEntries(
    runId: string,
    tmId: string,
    afterId: string,
    limit: number,
  ): Array<{ id: string }>;
  applyTMSyncInserts(tmId: string, rows: Array<TMSyncStagedRow & { id: string }>): number;
  applyTMSyncUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number;
  deleteTMEntriesWithFts(entryIds: string[]): number;
  optimizeTMFts(): void;
}

export interface TMSyncPipelineInput {
  tmId: string;
  filePath: string;
  columns: TMSyncColumns;
  deletePolicy: TMSyncDeletePolicy;
  syncRunId: string;
  lastSyncedAt?: string;
}

export interface TMSyncPipelineHooks {
  emitProgress?: (percent: number, message?: string) => void;
  isCancelled?: () => boolean;
  /** Called between chunked transactions so queued messages can be processed. */
  yieldBetweenChunks?: () => Promise<void>;
}

const STAGE_CHUNK_SIZE = 2000;
const APPLY_CHUNK_SIZE = 1000;
const FTS_OPTIMIZE_THRESHOLD = 20000;

// Overall progress budget per phase (percent).
const PARSE_END = 40;
const DIFF_END = 50;
const APPLY_END = 100;

function parseRow(
  cells: Array<string | number | boolean | null | undefined>,
  columns: TMSyncColumns,
): TMSyncStagedRow | null {
  const srcText =
    cells[columns.sourceCol] !== undefined ? String(cells[columns.sourceCol]).trim() : '';
  const tgtText =
    cells[columns.targetCol] !== undefined ? String(cells[columns.targetCol]).trim() : '';
  if (!srcText || !tgtText) return null;

  const sourceTokens = parseDisplayTextToTokens(srcText);
  const targetTokens = parseDisplayTextToTokens(tgtText);
  const tagsSignature = computeTagsSignature(sourceTokens);
  const matchKey = computeMatchKey(sourceTokens);
  const srcHash = computeSrcHash(matchKey, tagsSignature);

  return {
    srcHash,
    matchKey,
    tagsSignature,
    sourceTokensJson: JSON.stringify(sourceTokens),
    targetTokensJson: JSON.stringify(targetTokens),
    srcText,
    tgtText,
  };
}

/**
 * Incremental TM file sync: stage the parsed file, diff against tm_entries in
 * SQL, then apply only new/changed/(optionally) deleted rows in small
 * transactions. Idempotent: a cancelled or failed run leaves a consistent
 * prefix applied, and re-running converges.
 */
export async function runTMSyncPipeline(
  db: TMSyncDatabasePort,
  input: TMSyncPipelineInput,
  hooks: TMSyncPipelineHooks = {},
): Promise<TMSyncReport> {
  const emitProgress = hooks.emitProgress ?? (() => {});
  const isCancelled = hooks.isCancelled ?? (() => false);
  const yieldBetweenChunks = hooks.yieldBetweenChunks ?? (() => Promise.resolve());

  const report: TMSyncReport = {
    fileRows: 0,
    duplicates: 0,
    skipped: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    overwrittenLocalEdits: 0,
    deletedLocalEdits: 0,
  };

  const tm = db.getTM(input.tmId);
  if (!tm) {
    throw new Error('Target TM not found');
  }

  try {
    // Leftovers from a crashed or cancelled earlier run of THIS TM. Scoped by
    // tmId so concurrent syncs of other TMs keep their staged rows.
    db.clearTMSyncStagingForTM(input.tmId, input.syncRunId);

    // --- Phase A: parse the file and stage rows ---
    emitProgress(0, 'Reading linked spreadsheet...');
    let rows: ReturnType<typeof extractSheetRows> | null = null;
    {
      const worksheet = await readFirstSheet(input.filePath);
      const sourceRows = extractSheetRows(worksheet, {
        columnIndexes: [input.columns.sourceCol, input.columns.targetCol],
      });
      rows = input.columns.hasHeader ? sourceRows.slice(1) : sourceRows;
    }

    report.fileRows = rows.length;
    let validRows = 0;

    for (let i = 0; i < rows.length; i += STAGE_CHUNK_SIZE) {
      if (isCancelled()) break;
      const end = Math.min(i + STAGE_CHUNK_SIZE, rows.length);
      const parsed: TMSyncStagedRow[] = [];
      for (let j = i; j < end; j++) {
        const row = parseRow(rows[j].cells, input.columns);
        if (!row) {
          report.skipped += 1;
          continue;
        }
        parsed.push(row);
      }
      validRows += parsed.length;

      db.runInTransaction(() => {
        db.stageTMSyncRows(input.syncRunId, input.tmId, parsed);
      });

      emitProgress(
        rows.length === 0 ? PARSE_END : (end / rows.length) * PARSE_END,
        `Preparing ${end} of ${rows.length} rows...`,
      );
      await yieldBetweenChunks();
    }
    // Release the parsed workbook rows before the diff/apply phases.
    rows = null;

    if (isCancelled()) {
      report.cancelled = true;
      return report;
    }

    // --- Phase B: diff staged rows against the TM ---
    emitProgress(PARSE_END, 'Comparing with existing entries...');
    const stagedCount = db.countTMSyncStagedRows(input.syncRunId);
    report.duplicates = validRows - stagedCount;

    const diff = db.getTMSyncDiffSummary(input.syncRunId, input.tmId, input.lastSyncedAt);
    report.unchanged = stagedCount - diff.added - diff.changed;
    report.overwrittenLocalEdits = diff.overwrittenLocalEdits;

    const deletesPlanned = input.deletePolicy === 'prune-all' ? diff.deleted : 0;
    // Only a prune pass actually destroys locally edited missing entries.
    report.deletedLocalEdits = input.deletePolicy === 'prune-all' ? diff.deletedLocalEdits : 0;
    const totalApplyWork = diff.added + diff.changed + deletesPlanned;
    let applied = 0;
    const applyProgress = (message: string) => {
      const fraction = totalApplyWork === 0 ? 1 : applied / totalApplyWork;
      emitProgress(DIFF_END + fraction * (APPLY_END - DIFF_END), message);
    };

    emitProgress(
      DIFF_END,
      `Applying changes: ${diff.added} new, ${diff.changed} updated, ${deletesPlanned} removed...`,
    );

    // --- Phase C: apply in chunked transactions ---
    let cursor = '';
    while (!isCancelled()) {
      const page = db.listTMSyncNewRows(input.syncRunId, input.tmId, cursor, APPLY_CHUNK_SIZE);
      if (page.length === 0) break;
      cursor = page[page.length - 1].srcHash;

      report.added += db.runInTransaction(() =>
        db.applyTMSyncInserts(
          input.tmId,
          page.map((row) => ({ ...row, id: randomUUID() })),
        ),
      );
      applied += page.length;
      applyProgress(`Added ${report.added} of ${diff.added} new entries...`);
      await yieldBetweenChunks();
    }

    cursor = '';
    if (diff.changed > 0 && !isCancelled()) {
      applyProgress(`Updating ${diff.changed} changed entries...`);
    }
    while (!isCancelled()) {
      const page = db.listTMSyncChangedRows(input.syncRunId, input.tmId, cursor, APPLY_CHUNK_SIZE);
      if (page.length === 0) break;
      cursor = page[page.length - 1].srcHash;

      report.updated += db.runInTransaction(() =>
        db.applyTMSyncUpdates(
          input.tmId,
          page.map((row) => ({
            entryId: row.entryId,
            sourceTokensJson: row.sourceTokensJson,
            targetTokensJson: row.targetTokensJson,
            srcText: row.srcText,
            tgtText: row.tgtText,
          })),
        ),
      );
      applied += page.length;
      applyProgress(`Updated ${report.updated} of ${diff.changed} entries...`);
      await yieldBetweenChunks();
    }

    if (input.deletePolicy === 'prune-all') {
      cursor = '';
      if (deletesPlanned > 0 && !isCancelled()) {
        applyProgress(`Removing ${deletesPlanned} entries missing from the file...`);
      }
      while (!isCancelled()) {
        const page = db.listTMSyncDeletedEntries(
          input.syncRunId,
          input.tmId,
          cursor,
          APPLY_CHUNK_SIZE,
        );
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;

        report.deleted += db.runInTransaction(() =>
          db.deleteTMEntriesWithFts(page.map((row) => row.id)),
        );
        applied += page.length;
        applyProgress(`Removed ${report.deleted} of ${deletesPlanned} entries...`);
        await yieldBetweenChunks();
      }
    }

    if (
      !isCancelled() &&
      report.added + report.updated + report.deleted >= FTS_OPTIMIZE_THRESHOLD
    ) {
      emitProgress(APPLY_END, 'Optimizing search index...');
      db.optimizeTMFts();
    }

    if (isCancelled()) {
      report.cancelled = true;
    }
    emitProgress(
      APPLY_END,
      `Sync ${report.cancelled ? 'cancelled' : 'completed'}: ${report.added} added, ${report.updated} updated, ${report.deleted} removed, ${report.unchanged} unchanged.`,
    );
    return report;
  } finally {
    try {
      db.clearTMSyncStagingRun(input.syncRunId);
    } catch {
      // Leftover staging rows are cleaned up by the next run.
    }
  }
}
