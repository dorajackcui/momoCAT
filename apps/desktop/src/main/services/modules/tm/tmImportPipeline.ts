import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import { parseDisplayTextToTokens, computeTagsSignature } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import type { TMEntry, Token } from '@cat/core/models';
import { extractSheetRows } from '../../../filters/sheetRows';
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
 * Spreadsheet -> TM import. Single streaming pass so peak memory stays at
 * workbook + one chunk, matching pre-refactor behavior on large files.
 *
 * Within-file conflicts are last-wins: `writtenByRun` remembers which entry
 * each srcHash produced in THIS run, and a repeated srcHash rewrites that
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
  const workbook = XLSX.read(await readFile(input.filePath), { type: 'buffer' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
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

  // srcHash -> entry id written by this run, or null when the DB kept its
  // pre-existing entry (non-overwrite skip).
  const writtenByRun = new Map<string, string | null>();

  for (let i = 0; i < totalRows; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalRows);

    db.runInTransaction(() => {
      const ftsReplacements: TMFtsReplacementRow[] = [];

      for (let j = i; j < end; j++) {
        const row = parseTMImportRow(rows[j].cells, options);
        if (!row) {
          skipped++;
          continue;
        }

        const prior = writtenByRun.get(row.srcHash);

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
            writtenByRun.set(row.srcHash, entryId);
            success++;
            continue;
          }

          const insertedId = db.insertTMEntryIfAbsentBySrcHash(entryBase);
          if (!insertedId) {
            writtenByRun.set(row.srcHash, null);
            skipped++;
            continue;
          }

          db.insertTMFts(tmId, row.srcText, row.tgtText, insertedId);
          writtenByRun.set(row.srcHash, insertedId);
          success++;
          continue;
        }

        if (prior === null) {
          // The DB kept its entry for this source; later file duplicates
          // cannot override that decision without overwrite mode.
          skipped++;
          continue;
        }

        // Last-wins within the file: rewrite the entry this run created.
        // applyTMSyncUpdates refreshes tokens + FTS without touching
        // usageCount/createdAt, so file duplicates don't count as usage.
        db.applyTMSyncUpdates(tmId, [
          {
            entryId: prior,
            sourceTokensJson: JSON.stringify(row.sourceTokens),
            targetTokensJson: JSON.stringify(row.targetTokens),
            srcText: row.srcText,
            tgtText: row.tgtText,
          },
        ]);
        // Keep the queued overwrite-mode FTS replacement (if any) in lockstep,
        // so the batch flush at commit doesn't restore the older text.
        ftsReplacements.push({
          tmId,
          srcText: row.srcText,
          tgtText: row.tgtText,
          tmEntryId: prior,
        });
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
