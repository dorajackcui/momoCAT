import { join } from 'path';
import type { ExportReferencesForMtInput } from '@cat/localization';
import {
  WorkerBackedFileOperationRunner,
  type FileOperationWorkerFactory,
} from '../workers/WorkerBackedFileOperationRunner';
import type {
  ReferenceExportJobResult,
  ReferenceExportWorkerInput,
  ReferenceExportWorkerMessage,
} from './types';

export type ReferenceExportFallbackRunner = (
  input: ExportReferencesForMtInput,
) => Promise<ReferenceExportJobResult>;

interface ReferenceExportWorkerRunnerOptions {
  dbPath: string;
  workerFactory?: FileOperationWorkerFactory<
    ReferenceExportWorkerInput,
    ReferenceExportWorkerMessage
  >;
  workerPathCandidates?: string[];
  fallbackRunner?: ReferenceExportFallbackRunner;
}

export class ReferenceExportWorkerRunner {
  private readonly runner: WorkerBackedFileOperationRunner<
    ExportReferencesForMtInput,
    ReferenceExportWorkerInput,
    ReferenceExportJobResult
  >;

  constructor(options: ReferenceExportWorkerRunnerOptions) {
    this.runner = new WorkerBackedFileOperationRunner({
      dbPath: options.dbPath,
      operationLabel: 'ReferenceExport',
      workerDescription: 'Reference export worker',
      workerPathCandidates: options.workerPathCandidates ?? [
        join(__dirname, 'referenceExportWorker.js'),
        join(__dirname, '../referenceExportWorker.js'),
        join(__dirname, '../../referenceExportWorker.js'),
      ],
      buildWorkerInput: (dbPath, exportInput) => ({ dbPath, exportInput }),
      workerFactory: options.workerFactory,
      fallbackRunner: options.fallbackRunner,
    });
  }

  public run(input: ExportReferencesForMtInput): Promise<ReferenceExportJobResult> {
    return this.runner.run(input);
  }
}
