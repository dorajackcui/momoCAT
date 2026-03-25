import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { parseDisplayTextToTokens, computeTagsSignature } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import { extractSheetRows } from './filters/sheetRows';
import type { TMImportOptions } from '../shared/ipc';

interface TMImportWorkerInput {
  dbPath: string;
  tmId: string;
  filePath: string;
  options: TMImportOptions;
}

const port = parentPort;
if (!port) {
  throw new Error('TM import worker requires parentPort');
}

const emitProgress = (current: number, total: number, message?: string) => {
  port.postMessage({
    type: 'progress',
    current,
    total,
    message,
  });
};

const run = async () => {
  const input = workerData as TMImportWorkerInput;
  const db = new CATDatabase(input.dbPath);

  try {
    const tm = db.getTM(input.tmId);
    if (!tm) {
      throw new Error('Target TM not found');
    }

    emitProgress(0, 1, 'Reading spreadsheet...');
    const workbook = XLSX.read(await readFile(input.filePath), { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const sourceRows = extractSheetRows(worksheet, {
      columnIndexes: [input.options.sourceCol, input.options.targetCol],
    });
    const rows = input.options.hasHeader ? sourceRows.slice(1) : sourceRows;

    const totalRows = rows.length;
    let success = 0;
    let skipped = 0;

    if (totalRows === 0) {
      port.postMessage({ type: 'done', result: { success, skipped } });
      return;
    }

    emitProgress(0, totalRows, 'Preparing import...');

    const chunkSize = totalRows >= 100000 ? 1500 : 800;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, rows.length);

      db.runInTransaction(() => {
        for (let j = i; j < end; j++) {
          const row = rows[j].cells;

          const sourceText =
            row[input.options.sourceCol] !== undefined
              ? String(row[input.options.sourceCol]).trim()
              : '';
          const targetText =
            row[input.options.targetCol] !== undefined
              ? String(row[input.options.targetCol]).trim()
              : '';

          if (!sourceText || !targetText) {
            skipped++;
            continue;
          }

          const sourceTokens = parseDisplayTextToTokens(sourceText);
          const targetTokens = parseDisplayTextToTokens(targetText);
          const tagsSignature = computeTagsSignature(sourceTokens);
          const matchKey = computeMatchKey(sourceTokens);
          const srcHash = computeSrcHash(matchKey, tagsSignature);

          const now = new Date().toISOString();
          const entryBase = {
            id: randomUUID(),
            tmId: input.tmId,
            projectId: 0,
            srcLang: tm.srcLang,
            tgtLang: tm.tgtLang,
            srcHash,
            matchKey,
            tagsSignature,
            sourceTokens,
            targetTokens,
            usageCount: 1,
            createdAt: now,
            updatedAt: now,
          };

          if (input.options.overwrite) {
            const entryId = db.upsertTMEntryBySrcHash(entryBase);
            db.replaceTMFts(input.tmId, sourceText, targetText, entryId);
            success++;
            continue;
          }

          const insertedId = db.insertTMEntryIfAbsentBySrcHash(entryBase);
          if (!insertedId) {
            skipped++;
            continue;
          }

          db.insertTMFts(input.tmId, sourceText, targetText, insertedId);
          success++;
        }
      });

      const processedRows = end;
      emitProgress(processedRows, totalRows, `Imported ${processedRows} of ${totalRows} rows...`);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    port.postMessage({ type: 'done', result: { success, skipped } });
  } finally {
    db.close();
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  port.postMessage({ type: 'error', error: message });
});
