import { createHash, randomUUID } from 'crypto';
import { parseDisplayTextToTokens, computeTagsSignature } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import type { TMEntry, Token } from '@cat/core/models';
import { extractSheetRows, readFirstSheet } from '../../../filters/sheetRows';
import { dedupeRowsLastWins } from '../resourceImportRows';
import type { TMImportOptions } from '../../../../shared/ipc';

interface ParsedTMImportRow {
  srcHash: string;
  matchKey: string;
  tagsSignature: string;
  sourceTokens: Token[];
  targetTokens: Token[];
  srcText: string;
  tgtText: string;
}

interface TMFtsReplacementRow {
  tmId: string;
  srcText: string;
  tgtText: string;
  tmEntryId: string;
}

// Subset of CATDatabase the pipeline needs. The worker passes CATDatabase
// directly; the main-thread fallback adapts TMRepository + TransactionManager.
export interface TMImportDatabasePort {
  getTM(tmId: string): { srcLang: string; tgtLang: string } | undefined;
  runInTransaction<T>(fn: () => T): T;
  upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string;
  insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined;
  insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  replaceTMFtsBatch(rows: TMFtsReplacementRow[]): void;
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
}

export interface TMImportPipelineInput {
  tmId: string;
  filePath: string;
  options: TMImportOptions;
}

export interface TMImportPipelineHooks {
  emitProgress?: (current: number, total: number, message?: string) => void;
  /** Called between chunked transactions so queued messages can be processed. */
  yieldBetweenChunks?: () => Promise<void>;
}

function parseTMImportRow(
  cells: Array<string | number | boolean | null | undefined>,
  options: TMImportOptions,
): ParsedTMImportRow | null {
  const srcText =
    cells[options.sourceCol] !== undefined ? String(cells[options.sourceCol]).trim() : '';
  const tgtText =
    cells[options.targetCol] !== undefined ? String(cells[options.targetCol]).trim() : '';
  if (!srcText || !tgtText) return null;

  const sourceTokens = parseDisplayTextToTokens(srcText);
  const targetTokens = parseDisplayTextToTokens(tgtText);
  const tagsSignature = computeTagsSignature(sourceTokens);
  const matchKey = computeMatchKey(sourceTokens);
  const srcHash = computeSrcHash(matchKey, tagsSignature);

  return { srcHash, matchKey, tagsSignature, sourceTokens, targetTokens, srcText, tgtText };
}

/**
 * Spreadsheet -> TM import. Single streaming pass: parsed token rows live
 * only for the current chunk, so peak memory is workbook + one chunk + a
 * fixed-size-per-source digest map (see writtenByRun below).
 *
 * Within-file conflicts are last-wins: each chunk is reduced before its
 * transaction (in-chunk duplicates), and `writtenByRun` remembers which entry
 * each srcHash produced in THIS run so a cross-chunk repeat rewrites that
 * entry in place (no usageCount/createdAt churn). ON CONFLICT clauses then
 * express only file-vs-database policy: `overwrite` replaces pre-existing DB
 * entries, otherwise they win and the row counts as skipped.
 */
export async function runTMImportPipeline(
  db: TMImportDatabasePort,
  input: TMImportPipelineInput,
  hooks: TMImportPipelineHooks = {},
): Promise<{ success: number; skipped: number }> {
  const emitProgress = hooks.emitProgress ?? (() => {});
  const yieldBetweenChunks = hooks.yieldBetweenChunks ?? (() => Promise.resolve());
  const { tmId, options } = input;

  const tm = db.getTM(tmId);
  if (!tm) throw new Error('Target TM not found');

  emitProgress(0, 1, 'Reading spreadsheet...');
  const worksheet = await readFirstSheet(input.filePath);
  const sourceRows = extractSheetRows(worksheet, {
    columnIndexes: [options.sourceCol, options.targetCol],
  });
  const rows = options.hasHeader ? sourceRows.slice(1) : sourceRows;

  const totalRows = rows.length;
  let success = 0;
  let skipped = 0;

  if (totalRows === 0) {
    return { success, skipped };
  }

  const chunkSize = totalRows >= 100000 ? 1500 : 800;
  emitProgress(0, totalRows, 'Preparing import...');

  // Cross-chunk last-wins state: digest(srcHash) -> entry id written by this
  // run, or null when the DB kept its pre-existing entry (non-overwrite
  // skip). srcHash is the full normalized source text (matchKey:::tags), so
  // keying by its 16-byte SHA-256 prefix keeps the map at a fixed ~90 bytes
  // per unique source regardless of segment length (~9 MB per 100k). Token
  // arrays are not retained; peak heap is workbook + one parsed chunk + this
  // map.
  const srcHashDigest = (srcHash: string): string =>
    createHash('sha256').update(srcHash).digest('base64').slice(0, 22);
  const writtenByRun = new Map<string, string | null>();

  for (let i = 0; i < totalRows; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalRows);

    // Last-wins reduce within the chunk so each srcHash is written at most
    // once per transaction (in-chunk duplicates never reach the DB).
    const chunkRows: Array<ParsedTMImportRow | null> = [];
    for (let j = i; j < end; j++) {
      chunkRows.push(parseTMImportRow(rows[j].cells, options));
    }
    const deduped = dedupeRowsLastWins(chunkRows, (row) => row?.srcHash ?? null);
    skipped += deduped.invalid + deduped.duplicates;

    db.runInTransaction(() => {
      const ftsReplacements: TMFtsReplacementRow[] = [];

      for (const row of deduped.rows as ParsedTMImportRow[]) {
        const digest = srcHashDigest(row.srcHash);
        const prior = writtenByRun.get(digest);

        if (prior === undefined) {
          const now = new Date().toISOString();
          const entryBase = {
            id: randomUUID(),
            tmId,
            projectId: 0,
            srcLang: tm.srcLang,
            tgtLang: tm.tgtLang,
            srcHash: row.srcHash,
            matchKey: row.matchKey,
            tagsSignature: row.tagsSignature,
            sourceTokens: row.sourceTokens,
            targetTokens: row.targetTokens,
            usageCount: 1,
            createdAt: now,
            updatedAt: now,
          };

          if (options.overwrite) {
            const entryId = db.upsertTMEntryBySrcHash(entryBase);
            ftsReplacements.push({
              tmId,
              srcText: row.srcText,
              tgtText: row.tgtText,
              tmEntryId: entryId,
            });
            writtenByRun.set(digest, entryId);
            success++;
            continue;
          }

          const insertedId = db.insertTMEntryIfAbsentBySrcHash(entryBase);
          if (!insertedId) {
            writtenByRun.set(digest, null);
            skipped++;
            continue;
          }

          db.insertTMFts(tmId, row.srcText, row.tgtText, insertedId);
          writtenByRun.set(digest, insertedId);
          success++;
          continue;
        }

        if (prior === null) {
          // The DB kept its entry for this source; later file duplicates
          // cannot override that decision without overwrite mode.
          skipped++;
          continue;
        }

        // Cross-chunk duplicate: rewrite the entry this run created.
        // applyTMSyncUpdates refreshes tokens + FTS in one pass without
        // touching usageCount/createdAt. The earlier chunk's FTS write is
        // already committed, so this is the only FTS write for the row —
        // no ftsReplacements entry needed.
        db.applyTMSyncUpdates(tmId, [
          {
            entryId: prior,
            sourceTokensJson: JSON.stringify(row.sourceTokens),
            targetTokensJson: JSON.stringify(row.targetTokens),
            srcText: row.srcText,
            tgtText: row.tgtText,
          },
        ]);
        skipped++;
      }

      if (ftsReplacements.length > 0) {
        db.replaceTMFtsBatch(ftsReplacements);
      }
    });

    emitProgress(end, totalRows, `Imported ${end} of ${totalRows} rows...`);
    await yieldBetweenChunks();
  }

  return { success, skipped };
}
