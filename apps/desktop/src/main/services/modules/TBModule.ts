import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import type { Segment } from '@cat/core/models';
import {
  ProgressEmitter,
  SettingsRepository,
  SpreadsheetPreviewData,
  TBRepository,
  TransactionManager,
} from '../ports';
import { TBService } from '../TBService';
import { extractSheetRows } from '../../filters/sheetRows';
import type {
  TBAssetPreview,
  TBImportOptions,
  TBSyncColumns,
  TBSyncConfig,
  TBSyncConfigInput,
} from '../../../shared/ipc';

const ASSET_PREVIEW_ROW_LIMIT = 10;
const TB_SYNC_CONFIG_KEY_PREFIX = 'tb-sync-config:';

export interface ImportProgress {
  current: number;
  total: number;
  message?: string;
}

type ImportProgressCallback = (progress: ImportProgress) => void;

interface ParsedTermRow {
  srcTerm: string;
  tgtTerm: string;
  note: string | null;
}

export class TBModule {
  constructor(
    private readonly tbRepo: TBRepository,
    private readonly tx: TransactionManager,
    private readonly tbService: TBService,
    private readonly emitProgress: ProgressEmitter,
    private readonly settingsRepo: SettingsRepository,
  ) {}

  public async findTermMatches(projectId: number, segment: Segment) {
    return this.tbService.findMatches(projectId, segment);
  }

  public async listTBs() {
    const tbs = this.tbRepo.listTermBases();
    return tbs.map((tb) => ({
      ...tb,
      stats: this.tbRepo.getTermBaseStats(tb.id),
      syncConfig: this.getTBSyncConfig(tb.id),
    }));
  }

  public async createTB(name: string, srcLang: string, tgtLang: string) {
    return this.tbRepo.createTermBase(name, srcLang, tgtLang);
  }

  public async deleteTB(tbId: string) {
    this.tbRepo.deleteTermBase(tbId);
    this.settingsRepo.setSetting(tbSyncConfigKey(tbId), null);
  }

  public async getProjectMountedTBs(projectId: number) {
    const mounted = this.tbRepo.getProjectMountedTermBases(projectId);
    return mounted.map((tb) => ({
      ...tb,
      stats: this.tbRepo.getTermBaseStats(tb.id),
    }));
  }

  public async getTBPreview(tbId: string): Promise<TBAssetPreview> {
    const entries = this.tbRepo.listTBEntries(tbId, ASSET_PREVIEW_ROW_LIMIT, 0);

    return {
      tbId,
      rows: entries.slice(0, ASSET_PREVIEW_ROW_LIMIT).map((entry) => ({
        id: entry.id,
        sourceTerm: entry.srcTerm,
        targetTerm: entry.tgtTerm,
        note: entry.note,
        updatedAt: entry.updatedAt,
        usageCount: entry.usageCount,
      })),
    };
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
      'tb-import',
      { current: 0, total: 1, message: 'Reading spreadsheet...' },
      onProgress,
    );

    const rows = await this.readTermRows(filePath, options);
    return this.writeTermRows(tbId, tb.srcLang, rows, {
      overwrite: options.overwrite,
      progressType: 'tb-import',
      progressVerb: 'Imported',
      onProgress,
    });
  }

  public getTBSyncConfig(tbId: string): TBSyncConfig | null {
    const raw = this.settingsRepo.getSetting(tbSyncConfigKey(tbId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as TBSyncConfig;
      if (!parsed || typeof parsed.filePath !== 'string' || !parsed.columns) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public async setTBSyncConfig(tbId: string, input: TBSyncConfigInput): Promise<void> {
    const tb = this.tbRepo.getTermBase(tbId);
    if (!tb) throw new Error('Target TB not found');

    const existing = this.getTBSyncConfig(tbId);
    const next: TBSyncConfig = {
      ...(existing ?? {}),
      filePath: input.filePath,
      columns: input.columns,
    };
    this.settingsRepo.setSetting(tbSyncConfigKey(tbId), JSON.stringify(next));
  }

  public async syncTBEntriesFromExcel(
    tbId: string,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number; removed: number }> {
    const tb = this.tbRepo.getTermBase(tbId);
    if (!tb) throw new Error('Target TB not found');

    const config = this.getTBSyncConfig(tbId);
    if (!config) throw new Error('This term base is not bound to a local Excel file.');

    this.emitImportProgress(
      'tb-sync',
      { current: 0, total: 1, message: 'Reading linked spreadsheet...' },
      onProgress,
    );

    try {
      // Parse the full workbook before touching the TB so an unreadable or
      // malformed file never leaves the term base half-cleared.
      const rows = await this.readTermRows(config.filePath, config.columns);
      const removed = this.tbRepo.getTermBaseStats(tbId).entryCount;

      this.emitImportProgress(
        'tb-sync',
        { current: 0, total: rows.length, message: 'Mirroring entries...' },
        onProgress,
      );

      // Clear + rewrite in a single transaction: a failed insert rolls the
      // whole mirror back instead of leaving the TB emptied or partial.
      const written = this.tx.runInTransaction(() => {
        this.tbRepo.clearTermBaseEntries(tbId);
        return this.writeTermRowsChunk(tbId, tb.srcLang, rows, false);
      });

      this.emitImportProgress(
        'tb-sync',
        {
          current: rows.length,
          total: rows.length,
          message: `Synced ${written.success} of ${rows.length} rows.`,
        },
        onProgress,
      );

      this.recordSyncOutcome(tbId, config, { status: 'success' });
      return { ...written, removed };
    } catch (error) {
      this.recordSyncOutcome(tbId, config, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async readTermRows(filePath: string, columns: TBSyncColumns): Promise<ParsedTermRow[]> {
    const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const columnIndexes = [columns.sourceCol, columns.targetCol];
    if (typeof columns.noteCol === 'number') {
      columnIndexes.push(columns.noteCol);
    }
    const sourceRows = extractSheetRows(worksheet, { columnIndexes });
    const rows = columns.hasHeader ? sourceRows.slice(1) : sourceRows;

    return rows.map((row) => {
      const cells = row.cells;
      return {
        srcTerm:
          cells[columns.sourceCol] !== undefined ? String(cells[columns.sourceCol]).trim() : '',
        tgtTerm:
          cells[columns.targetCol] !== undefined ? String(cells[columns.targetCol]).trim() : '',
        note:
          columns.noteCol !== undefined && cells[columns.noteCol] !== undefined
            ? String(cells[columns.noteCol]).trim()
            : null,
      };
    });
  }

  private async writeTermRows(
    tbId: string,
    srcLang: string,
    rows: ParsedTermRow[],
    options: {
      overwrite: boolean;
      progressType: 'tb-import' | 'tb-sync';
      progressVerb: string;
      onProgress?: ImportProgressCallback;
    },
  ): Promise<{ success: number; skipped: number }> {
    const totalRows = rows.length;
    let success = 0;
    let skipped = 0;

    if (totalRows === 0) {
      return { success, skipped };
    }

    const chunkSize = totalRows >= 100000 ? 1500 : 800;
    this.emitImportProgress(
      options.progressType,
      { current: 0, total: totalRows, message: 'Preparing entries...' },
      options.onProgress,
    );

    for (let i = 0; i < rows.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, rows.length);

      const written = this.tx.runInTransaction(() =>
        this.writeTermRowsChunk(tbId, srcLang, rows.slice(i, end), options.overwrite),
      );
      success += written.success;
      skipped += written.skipped;

      const processedRows = end;
      this.emitImportProgress(
        options.progressType,
        {
          current: processedRows,
          total: totalRows,
          message: `${options.progressVerb} ${processedRows} of ${totalRows} rows...`,
        },
        options.onProgress,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return { success, skipped };
  }

  // Must be called inside a transaction owned by the caller.
  private writeTermRowsChunk(
    tbId: string,
    srcLang: string,
    rows: ParsedTermRow[],
    overwrite: boolean,
  ): { success: number; skipped: number } {
    let success = 0;
    let skipped = 0;

    for (const { srcTerm, tgtTerm, note } of rows) {
      if (!srcTerm || !tgtTerm) {
        skipped += 1;
        continue;
      }

      const entryBase = {
        id: randomUUID(),
        tbId,
        srcLang,
        srcTerm,
        tgtTerm,
        note,
      };

      if (overwrite) {
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

    return { success, skipped };
  }

  private recordSyncOutcome(
    tbId: string,
    config: TBSyncConfig,
    outcome: { status: 'success' | 'failed'; error?: string },
  ): void {
    const next: TBSyncConfig = {
      ...config,
      lastSyncedAt: new Date().toISOString(),
      lastSyncStatus: outcome.status,
    };
    if (outcome.error) {
      next.lastSyncError = outcome.error;
    } else {
      delete next.lastSyncError;
    }
    this.settingsRepo.setSetting(tbSyncConfigKey(tbId), JSON.stringify(next));
  }

  private emitImportProgress(
    type: 'tb-import' | 'tb-sync',
    progress: ImportProgress,
    onProgress?: ImportProgressCallback,
  ) {
    this.emitProgress({
      type,
      current: progress.current,
      total: progress.total,
      message: progress.message,
    });
    onProgress?.(progress);
  }
}

function tbSyncConfigKey(tbId: string): string {
  return `${TB_SYNC_CONFIG_KEY_PREFIX}${tbId}`;
}
