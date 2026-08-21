import { randomUUID } from 'crypto';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { access } from 'fs/promises';
import type { ProgressEmitter, SettingsRepository, TMRepository } from '../../ports';
import type {
  TMSyncColumnIdentity,
  TMSyncColumns,
  TMSyncConfig,
  TMSyncConfigInput,
  TMSyncReport,
} from '../../../../shared/ipc';
import { TM_SYNC_MAPPING_REVIEW_REQUIRED } from '../../../../shared/ipc';
import type { ImportProgress, ImportProgressCallback, TMSyncWorkerMessage } from './types';
import { readTMSyncColumnIdentity } from './tmSyncPipeline';

const TM_SYNC_CONFIG_KEY_PREFIX = 'tm-sync-config:';
type ColumnIdentityResolver = (
  filePath: string,
  columns: TMSyncColumns,
) => Promise<TMSyncColumnIdentity>;

export class TMSyncService {
  private readonly activeWorkers = new Map<string, Worker>();
  // Headerless sheets have no semantic column identity. Re-saving their
  // mapping authorizes exactly the next sync in this process; the authorization
  // is deliberately not persisted across runs or app restarts.
  private readonly reviewedHeaderlessMappings = new Set<string>();
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
    private readonly resolveColumnIdentity: ColumnIdentityResolver = readTMSyncColumnIdentity,
  ) {}

  public getTMSyncConfig(tmId: string): TMSyncConfig | null {
    const raw = this.settingsRepo.getSetting(tmSyncConfigKey(tmId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as TMSyncConfig & { deletePolicy?: unknown };
      if (!parsed || typeof parsed.filePath !== 'string' || !parsed.columns) return null;
      // Older builds persisted an optional delete policy. Sync is now always a
      // strict mirror, so tolerate that legacy field without letting it alter
      // behavior or survive the next config/outcome write.
      const config = { ...parsed };
      delete config.deletePolicy;
      return config;
    } catch {
      return null;
    }
  }

  public async setTMSyncConfig(tmId: string, input: TMSyncConfigInput): Promise<void> {
    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');
    if (tm.type !== 'main') throw new Error('Only Main TMs can be synced with an external file.');
    validateTMSyncConfigInput(input);
    const columnIdentity = await this.resolveColumnIdentity(input.filePath, input.columns);

    const existing = this.getTMSyncConfig(tmId);
    // A changed file or mapping starts a new sync relationship: the old
    // history describes a different source projection and must not carry over.
    const sameBinding =
      existing?.filePath === input.filePath &&
      existing.columns.sourceCol === input.columns.sourceCol &&
      existing.columns.targetCol === input.columns.targetCol &&
      existing.columns.hasHeader === input.columns.hasHeader &&
      columnIdentitiesEqual(existing.columnIdentity, columnIdentity);
    const next: TMSyncConfig = {
      ...(sameBinding ? (existing ?? {}) : {}),
      filePath: input.filePath,
      columns: input.columns,
      columnIdentity,
    };
    this.settingsRepo.setSetting(tmSyncConfigKey(tmId), JSON.stringify(next));
    if (columnIdentity.kind === 'positions') {
      this.reviewedHeaderlessMappings.add(tmId);
    } else {
      this.reviewedHeaderlessMappings.delete(tmId);
    }
  }

  public clearTMSyncConfig(tmId: string): void {
    this.settingsRepo.setSetting(tmSyncConfigKey(tmId), null);
    this.reviewedHeaderlessMappings.delete(tmId);
  }

  public cancelSync(tmId: string): boolean {
    if (!this.activeSyncs.has(tmId)) return false;
    this.pendingCancels.add(tmId);
    this.activeWorkers.get(tmId)?.postMessage({ type: 'cancel' });
    return true;
  }

  public getSyncStartIssue(tmId: string): string | null {
    const config = this.getTMSyncConfig(tmId);
    if (!config) return 'This TM is not bound to a local Excel file.';
    try {
      validateTMSyncConfigInput(config);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (!config.columnIdentity) {
      return 'The saved source/target mapping predates strict sync and must be reviewed.';
    }
    try {
      validateTMSyncColumnIdentity(config.columnIdentity, config.columns);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (config.columnIdentity.kind === 'positions' && !this.reviewedHeaderlessMappings.has(tmId)) {
      return 'Headerless source/target columns must be reviewed before every strict sync.';
    }
    return null;
  }

  public async syncTMEntriesFromExcel(
    tmId: string,
    onProgress?: ImportProgressCallback,
  ): Promise<TMSyncReport> {
    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');

    const config = this.getTMSyncConfig(tmId);
    if (!config) throw new Error('This TM is not bound to a local Excel file.');
    const startIssue = this.getSyncStartIssue(tmId);
    if (startIssue) throw new Error(`${TM_SYNC_MAPPING_REVIEW_REQUIRED}: ${startIssue}`);
    const columnIdentity = config.columnIdentity;
    if (!columnIdentity) throw new Error('The saved source/target mapping must be reviewed.');
    if (this.activeSyncs.has(tmId)) {
      throw new Error('A sync for this TM is already running.');
    }
    // Claimed synchronously, before the first await, so a second call in the
    // same tick cannot double-start.
    this.activeSyncs.add(tmId);
    if (columnIdentity.kind === 'positions') {
      this.reviewedHeaderlessMappings.delete(tmId);
    }

    try {
      // The bound file must be readable before we spin up the worker.
      await access(config.filePath);

      try {
        const report = await this.runSyncWorker(tmId, { ...config, columnIdentity }, onProgress);
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
    config: TMSyncConfig & { columnIdentity: TMSyncColumnIdentity },
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
          columnIdentity: config.columnIdentity,
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

// The renderer UI constrains these, but the config also arrives over IPC, so
// the main process is the trust boundary. A same-column mapping would bulk
// rewrite every target to its source text on the next sync.
function validateTMSyncConfigInput(input: TMSyncConfigInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('A TM sync configuration is required.');
  }
  if (typeof input.filePath !== 'string' || input.filePath.trim() === '') {
    throw new Error('A file path is required for TM sync.');
  }
  const columns = input.columns;
  if (!columns || typeof columns !== 'object') {
    throw new Error('Source and target columns are required.');
  }
  const { sourceCol, targetCol } = columns;
  if (
    !Number.isInteger(sourceCol) ||
    sourceCol < 0 ||
    !Number.isInteger(targetCol) ||
    targetCol < 0
  ) {
    throw new Error('Source and target columns must be nonnegative integers.');
  }
  if (sourceCol === targetCol) {
    throw new Error('Source and target columns must be different.');
  }
  if (typeof columns.hasHeader !== 'boolean') {
    throw new Error('The header setting must be true or false.');
  }
}

function validateTMSyncColumnIdentity(
  identity: TMSyncColumnIdentity,
  columns: TMSyncColumns,
): void {
  if (!identity || (identity.kind !== 'headers' && identity.kind !== 'positions')) {
    throw new Error('The saved source/target mapping identity is invalid and must be reviewed.');
  }
  if (identity.sourceCol !== columns.sourceCol || identity.targetCol !== columns.targetCol) {
    throw new Error('The saved source/target column positions changed and must be reviewed.');
  }
  if (
    identity.kind === 'headers' &&
    (typeof identity.sourceHeader !== 'string' ||
      identity.sourceHeader.trim() === '' ||
      typeof identity.targetHeader !== 'string' ||
      identity.targetHeader.trim() === '')
  ) {
    throw new Error('The saved source/target headers are invalid and must be reviewed.');
  }
}

function columnIdentitiesEqual(
  left: TMSyncColumnIdentity | undefined,
  right: TMSyncColumnIdentity,
): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (left.sourceCol !== right.sourceCol || left.targetCol !== right.targetCol) return false;
  return (
    left.kind === 'positions' ||
    (right.kind === 'headers' &&
      left.sourceHeader === right.sourceHeader &&
      left.targetHeader === right.targetHeader)
  );
}
