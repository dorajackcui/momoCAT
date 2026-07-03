import { access } from 'fs/promises';
import { join } from 'path';
import { Worker } from 'worker_threads';
import type { ExportReferencesForMtInput } from '@cat/localization';
import type {
  ReferenceExportJobResult,
  ReferenceExportWorkerInput,
  ReferenceExportWorkerMessage,
} from './types';

interface WorkerLike {
  on(event: 'message', listener: (message: ReferenceExportWorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
}

type WorkerFactory = (
  workerPath: string,
  options: { workerData: ReferenceExportWorkerInput },
) => WorkerLike;

export type ReferenceExportFallbackRunner = (
  input: ExportReferencesForMtInput,
) => Promise<ReferenceExportJobResult>;

interface ReferenceExportWorkerRunnerOptions {
  dbPath: string;
  workerFactory?: WorkerFactory;
  workerPathCandidates?: string[];
  fallbackRunner?: ReferenceExportFallbackRunner;
}

export class ReferenceExportWorkerRunner {
  private workerPath: string | null = null;

  constructor(private readonly options: ReferenceExportWorkerRunnerOptions) {}

  public async run(input: ExportReferencesForMtInput): Promise<ReferenceExportJobResult> {
    const candidatePaths = this.options.workerPathCandidates ?? [
      join(__dirname, 'referenceExportWorker.js'),
      join(__dirname, '../referenceExportWorker.js'),
      join(__dirname, '../../referenceExportWorker.js'),
    ];
    const workerPath = await this.resolveWorkerPath(candidatePaths);

    if (!workerPath) {
      // Only fall back when the worker script cannot be started at all (dev/test
      // path layouts). Errors from a running worker are real export failures and
      // are propagated instead of re-running the whole export on the main thread.
      if (this.options.fallbackRunner) {
        console.error(
          `[ReferenceExport] Worker not found, falling back to main thread. Tried: ${candidatePaths.join(', ')}`,
        );
        return this.options.fallbackRunner(input);
      }
      throw new Error(`Reference export worker not found. Tried: ${candidatePaths.join(', ')}`);
    }

    const { onProgress, ...exportInput } = input;
    const workerFactory = this.options.workerFactory ?? this.createWorker;

    return new Promise<ReferenceExportJobResult>((resolve, reject) => {
      const worker = workerFactory(workerPath, {
        workerData: { dbPath: this.options.dbPath, exportInput },
      });
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      worker.on('message', (message) => {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'progress') {
          onProgress?.(Number(message.current) || 0, Number(message.total) || 0);
          return;
        }

        if (message.type === 'done') {
          if (settled) return;
          settled = true;
          resolve(message.result);
          return;
        }

        if (message.type === 'error') {
          fail(new Error(message.error || 'Reference export worker failed'));
        }
      });

      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (settled) return;
        if (code === 0) {
          fail(new Error('Reference export worker exited without returning result'));
          return;
        }
        fail(new Error(`Reference export worker exited with code ${code}`));
      });
    });
  }

  private async resolveWorkerPath(candidatePaths: string[]): Promise<string | null> {
    if (this.workerPath) {
      return this.workerPath;
    }

    for (const candidatePath of candidatePaths) {
      try {
        await access(candidatePath);
        this.workerPath = candidatePath;
        return candidatePath;
      } catch {
        // Try the next packaged worker location.
      }
    }

    return null;
  }

  private createWorker: WorkerFactory = (workerPath, options) => new Worker(workerPath, options);
}
