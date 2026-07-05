import { randomUUID } from 'crypto';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { access } from 'fs/promises';
import type { ProgressEmitter, SettingsRepository, TMRepository } from '../../ports';
import type { TMSyncConfig, TMSyncConfigInput, TMSyncReport } from '../../../../shared/ipc';
import type { ImportProgress, ImportProgressCallback, TMSyncWorkerMessage } from './types';

const TM_SYNC_CONFIG_KEY_PREFIX = 'tm-sync-config:';

export class TMSyncService {
  private readonly activeWorkers = new Map<string, Worker>();
  // Syncs are tracked from the first synchronous moment of
  // syncTMEntriesFromExcel, not from worker spawn: a cancel that lands in the
  // startup window (file precheck, worker path resolution) is remembered in
  // pendingCancels and delivered as soon as the worker exists.
  private readonly activeSyncs = new Set<string>();
  private readonly pendingCancels = new Set<string>();

  constructor(
    private readonly tmRepo: TMRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly dbPath: string,
    private readonly emitProgress: ProgressEmitter,
  ) {}

  public getTMSyncConfig(tmId: string): TMSyncConfig | null {
    const raw = this.settingsRepo.getSetting(tmSyncConfigKey(tmId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as TMSyncConfig;
      if (!parsed || typeof parsed.filePath !== 'string' || !parsed.columns) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public async setTMSyncConfig(tmId: string, input: TMSyncConfigInput): Promise<void> {
    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');

    const existing = this.getTMSyncConfig(tmId);
    const next: TMSyncConfig = {
      ...(existing ?? {}),
      filePath: input.filePath,
      columns: input.columns,
      deletePolicy: input.deletePolicy ?? existing?.deletePolicy ?? 'never',
    };
    this.settingsRepo.setSetting(tmSyncConfigKey(tmId), JSON.stringify(next));
  }

  public clearTMSyncConfig(tmId: string): void {
    this.settingsRepo.setSetting(tmSyncConfigKey(tmId), null);
  }

  public cancelSync(tmId: string): boolean {
    if (!this.activeSyncs.has(tmId)) return false;
    this.pendingCancels.add(tmId);
    this.activeWorkers.get(tmId)?.postMessage({ type: 'cancel' });
    return true;
  }

  public async syncTMEntriesFromExcel(
    tmId: string,
    onProgress?: ImportProgressCallback,
  ): Promise<TMSyncReport> {
    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');

    const config = this.getTMSyncConfig(tmId);
    if (!config) throw new Error('This TM is not bound to a local Excel file.');
    if (this.activeSyncs.has(tmId)) {
      throw new Error('A sync for this TM is already running.');
    }
    // Claimed synchronously, before the first await, so a second call in the
    // same tick cannot double-start.
    this.activeSyncs.add(tmId);

    try {
      // The bound file must be readable before we spin up the worker.
      await access(config.filePath);

      try {
        const report = await this.runSyncWorker(tmId, config, onProgress);
        this.recordSyncOutcome(tmId, config, {
          status: report.cancelled ? 'cancelled' : 'success',
          report,
        });
        return report;
      } catch (error) {
        this.recordSyncOutcome(tmId, config, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } finally {
      this.activeSyncs.delete(tmId);
      this.pendingCancels.delete(tmId);
    }
  }

  // No main-thread fallback on purpose: a 150k-row sync on the main thread
  // would block the UI for minutes; failing loudly is the better outcome.
  private async runSyncWorker(
    tmId: string,
    config: TMSyncConfig,
    onProgress?: ImportProgressCallback,
  ): Promise<TMSyncReport> {
    const candidatePaths = [
      join(__dirname, 'tmSyncWorker.js'),
      join(__dirname, '../tmSyncWorker.js'),
      join(__dirname, '../../tmSyncWorker.js'),
    ];
    const workerPath = await this.resolveWorkerPath(candidatePaths);
    if (!workerPath) {
      throw new Error(`TM sync worker not found. Tried: ${candidatePaths.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          dbPath: this.dbPath,
          tmId,
          filePath: config.filePath,
          columns: config.columns,
          deletePolicy: config.deletePolicy ?? 'never',
          syncRunId: randomUUID(),
          lastSyncedAt: config.lastSyncedAt,
        },
      });
      this.activeWorkers.set(tmId, worker);
      // A cancel that arrived while the worker was still starting up.
      if (this.pendingCancels.has(tmId)) {
        worker.postMessage({ type: 'cancel' });
      }
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.activeWorkers.delete(tmId);
        fn();
      };

      worker.on('message', (message: TMSyncWorkerMessage) => {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'progress') {
          this.emitSyncProgress(
            {
              current: Number(message.percent) || 0,
              total: 100,
              message: typeof message.message === 'string' ? message.message : undefined,
            },
            onProgress,
          );
          return;
        }

        if (message.type === 'done') {
          settle(() => resolve(message.result));
          return;
        }

        if (message.type === 'error') {
          settle(() => reject(new Error(message.error || 'TM sync worker failed')));
        }
      });

      worker.on('error', (error) => settle(() => reject(error)));
      worker.on('exit', (code) => {
        settle(() =>
          reject(
            new Error(
              code === 0
                ? 'TM sync worker exited without returning a result'
                : `TM sync worker exited with code ${code}`,
            ),
          ),
        );
      });
    });
  }

  private recordSyncOutcome(
    tmId: string,
    config: TMSyncConfig,
    outcome: { status: 'success' | 'failed' | 'cancelled'; error?: string; report?: TMSyncReport },
  ): void {
    const now = new Date().toISOString();
    const next: TMSyncConfig = {
      ...config,
      lastSyncAttemptedAt: now,
      lastSyncStatus: outcome.status,
    };
    // lastSyncedAt is the overwrittenLocalEdits baseline for the next diff, so
    // it only moves on a FULL success: a cancelled/failed run applied at most
    // a prefix, and advancing the baseline would hide local edits in the
    // unapplied remainder from the next run's overwrite count.
    if (outcome.status === 'success') {
      next.lastSyncedAt = now;
    }
    if (outcome.error) {
      next.lastSyncError = outcome.error;
    } else {
      delete next.lastSyncError;
    }
    if (outcome.report) {
      next.lastSyncReport = outcome.report;
    }
    this.settingsRepo.setSetting(tmSyncConfigKey(tmId), JSON.stringify(next));
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

  private emitSyncProgress(progress: ImportProgress, onProgress?: ImportProgressCallback) {
    this.emitProgress({
      type: 'tm-sync',
      current: progress.current,
      total: progress.total,
      message: progress.message,
    });
    onProgress?.(progress);
  }
}

function tmSyncConfigKey(tmId: string): string {
  return `${TM_SYNC_CONFIG_KEY_PREFIX}${tmId}`;
}
