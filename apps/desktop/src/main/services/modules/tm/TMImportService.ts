import { join } from 'path';
import { Worker } from 'worker_threads';
import { access } from 'fs/promises';
import { extractSheetRows, readFirstSheet } from '../../../filters/sheetRows';
import { runTMImportPipeline, type TMImportDatabasePort } from './tmImportPipeline';
import type {
  ProgressEmitter,
  SpreadsheetPreviewData,
  TMRepository,
  TransactionManager,
} from '../../ports';
import type { TMImportOptions } from '../../../../shared/ipc';
import type { ImportProgress, ImportProgressCallback, TMImportWorkerMessage } from './types';

export class TMImportService {
  constructor(
    private readonly tmRepo: TMRepository,
    private readonly tx: TransactionManager,
    private readonly dbPath: string,
    private readonly emitProgress: ProgressEmitter,
  ) {}

  public async getTMImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    const worksheet = await readFirstSheet(filePath);
    return extractSheetRows(worksheet, { maxRows: 10 }).map((row) => row.cells);
  }

  public async importTMEntries(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    try {
      return await this.importTMEntriesInWorker(tmId, filePath, options, onProgress);
    } catch (error) {
      console.error('[TMModule] TM import worker failed, falling back to main thread:', error);
      return this.importTMEntriesInMainThread(tmId, filePath, options, onProgress);
    }
  }

  private async importTMEntriesInWorker(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    const candidatePaths = [
      join(__dirname, 'tmImportWorker.js'),
      join(__dirname, '../tmImportWorker.js'),
      join(__dirname, '../../tmImportWorker.js'),
    ];
    const workerPath = await this.resolveWorkerPath(candidatePaths);
    if (!workerPath) {
      throw new Error(`TM import worker not found. Tried: ${candidatePaths.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          dbPath: this.dbPath,
          tmId,
          filePath,
          options,
        },
      });
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      worker.on('message', (message: TMImportWorkerMessage) => {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'progress') {
          this.emitImportProgress(
            {
              current: Number(message.current) || 0,
              total: Number(message.total) || 0,
              message: typeof message.message === 'string' ? message.message : undefined,
            },
            onProgress,
          );
          return;
        }

        if (message.type === 'done') {
          if (settled) return;
          settled = true;
          resolve(message.result ?? { success: 0, skipped: 0 });
          return;
        }

        if (message.type === 'error') {
          fail(new Error(message.error || 'TM import worker failed'));
        }
      });

      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (settled) return;
        if (code === 0) {
          fail(new Error('TM import worker exited without returning result'));
          return;
        }
        fail(new Error(`TM import worker exited with code ${code}`));
      });
    });
  }

  private async importTMEntriesInMainThread(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    const db: TMImportDatabasePort = {
      getTM: (id) => this.tmRepo.getTM(id),
      runInTransaction: (fn) => this.tx.runInTransaction(fn),
      upsertTMEntryBySrcHash: (entry) => this.tmRepo.upsertTMEntryBySrcHash(entry),
      insertTMEntryIfAbsentBySrcHash: (entry) => this.tmRepo.insertTMEntryIfAbsentBySrcHash(entry),
      insertTMFts: (id, srcText, tgtText, tmEntryId) =>
        this.tmRepo.insertTMFts(id, srcText, tgtText, tmEntryId),
      replaceTMFtsBatch: (rows) => this.tmRepo.replaceTMFtsBatch(rows),
      applyTMSyncUpdates: (id, rows) => this.tmRepo.applyTMSyncUpdates(id, rows),
    };

    return runTMImportPipeline(
      db,
      { tmId, filePath, options },
      {
        emitProgress: (current, total, message) => {
          this.emitImportProgress({ current, total, message }, onProgress);
        },
        yieldBetweenChunks: () => new Promise<void>((resolve) => setImmediate(resolve)),
      },
    );
  }

  private async resolveWorkerPath(candidatePaths: string[]): Promise<string | undefined> {
    for (const candidatePath of candidatePaths) {
      try {
        await access(candidatePath);
        return candidatePath;
      } catch {
        // Ignore missing path candidate and try next.
      }
    }
    return undefined;
  }

  private emitImportProgress(progress: ImportProgress, onProgress?: ImportProgressCallback) {
    this.emitProgress({
      type: 'tm-import',
      current: progress.current,
      total: progress.total,
      message: progress.message,
    });
    onProgress?.(progress);
  }
}
