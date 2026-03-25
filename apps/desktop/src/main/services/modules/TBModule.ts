import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import type { Segment } from '@cat/core/models';
import {
  ProgressEmitter,
  SpreadsheetPreviewData,
  TBRepository,
  TransactionManager,
} from '../ports';
import { TBService } from '../TBService';
import { extractSheetRows } from '../../filters/sheetRows';
import type { TBImportOptions } from '../../../shared/ipc';

export interface ImportProgress {
  current: number;
  total: number;
  message?: string;
}

type ImportProgressCallback = (progress: ImportProgress) => void;

export class TBModule {
  constructor(
    private readonly tbRepo: TBRepository,
    private readonly tx: TransactionManager,
    private readonly tbService: TBService,
    private readonly emitProgress: ProgressEmitter,
  ) {}

  public async findTermMatches(projectId: number, segment: Segment) {
    return this.tbService.findMatches(projectId, segment);
  }

  public async listTBs() {
    const tbs = this.tbRepo.listTermBases();
    return tbs.map((tb) => ({
      ...tb,
      stats: this.tbRepo.getTermBaseStats(tb.id),
    }));
  }

  public async createTB(name: string, srcLang: string, tgtLang: string) {
    return this.tbRepo.createTermBase(name, srcLang, tgtLang);
  }

  public async deleteTB(tbId: string) {
    this.tbRepo.deleteTermBase(tbId);
  }

  public async getProjectMountedTBs(projectId: number) {
    const mounted = this.tbRepo.getProjectMountedTermBases(projectId);
    return mounted.map((tb) => ({
      ...tb,
      stats: this.tbRepo.getTermBaseStats(tb.id),
    }));
  }

  public async mountTBToProject(projectId: number, tbId: string, priority?: number) {
    this.tbRepo.mountTermBaseToProject(projectId, tbId, priority);
  }

  public async unmountTBFromProject(projectId: number, tbId: string) {
    this.tbRepo.unmountTermBaseFromProject(projectId, tbId);
  }

  public async getTBImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    return extractSheetRows(worksheet, { maxRows: 10 }).map((row) => row.cells);
  }

  public async importTBEntries(
    tbId: string,
    filePath: string,
    options: TBImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    const tb = this.tbRepo.getTermBase(tbId);
    if (!tb) throw new Error('Target TB not found');

    this.emitImportProgress(
      { current: 0, total: 1, message: 'Reading spreadsheet...' },
      onProgress,
    );

    const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const columnIndexes = [options.sourceCol, options.targetCol];
    if (typeof options.noteCol === 'number') {
      columnIndexes.push(options.noteCol);
    }
    const sourceRows = extractSheetRows(worksheet, { columnIndexes });
    const rows = options.hasHeader ? sourceRows.slice(1) : sourceRows;

    const totalRows = rows.length;
    let success = 0;
    let skipped = 0;

    if (totalRows === 0) {
      return { success, skipped };
    }

    const chunkSize = totalRows >= 100000 ? 1500 : 800;
    this.emitImportProgress(
      { current: 0, total: totalRows, message: 'Preparing import...' },
      onProgress,
    );

    for (let i = 0; i < rows.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, rows.length);

      this.tx.runInTransaction(() => {
        for (let j = i; j < end; j++) {
          const row = rows[j].cells;

          const srcTerm =
            row[options.sourceCol] !== undefined ? String(row[options.sourceCol]).trim() : '';
          const tgtTerm =
            row[options.targetCol] !== undefined ? String(row[options.targetCol]).trim() : '';
          const note =
            options.noteCol !== undefined && row[options.noteCol] !== undefined
              ? String(row[options.noteCol]).trim()
              : null;

          if (!srcTerm || !tgtTerm) {
            skipped += 1;
            continue;
          }

          const entryBase = {
            id: randomUUID(),
            tbId,
            srcLang: tb.srcLang,
            srcTerm,
            tgtTerm,
            note,
          };

          if (options.overwrite) {
            this.tbRepo.upsertTBEntryBySrcTerm(entryBase);
            success += 1;
            continue;
          }

          const insertedId = this.tbRepo.insertTBEntryIfAbsentBySrcTerm(entryBase);
          if (!insertedId) {
            skipped += 1;
            continue;
          }

          success += 1;
        }
      });

      const processedRows = end;
      this.emitImportProgress(
        {
          current: processedRows,
          total: totalRows,
          message: `Imported ${processedRows} of ${totalRows} rows...`,
        },
        onProgress,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return { success, skipped };
  }

  private emitImportProgress(progress: ImportProgress, onProgress?: ImportProgressCallback) {
    this.emitProgress({
      type: 'tb-import',
      current: progress.current,
      total: progress.total,
      message: progress.message,
    });
    onProgress?.(progress);
  }
}
