import { join } from 'path';
import {
  WorkerBackedFileOperationRunner,
  type FileOperationWorkerFactory,
} from '../workers/WorkerBackedFileOperationRunner';
import type {
  SourceTerminologyPrecheckJobResult,
  SourceTerminologyPrecheckOperationInput,
  SourceTerminologyPrecheckWorkerInput,
  SourceTerminologyPrecheckWorkerMessage,
} from './types';

export type SourceTerminologyPrecheckFallbackRunner = (
  input: SourceTerminologyPrecheckOperationInput,
) => Promise<SourceTerminologyPrecheckJobResult>;

interface SourceTerminologyPrecheckWorkerRunnerOptions {
  dbPath: string;
  workerFactory?: FileOperationWorkerFactory<
    SourceTerminologyPrecheckWorkerInput,
    SourceTerminologyPrecheckWorkerMessage
  >;
  workerPathCandidates?: string[];
  fallbackRunner?: SourceTerminologyPrecheckFallbackRunner;
}

export class SourceTerminologyPrecheckWorkerRunner {
  private readonly runner: WorkerBackedFileOperationRunner<
    SourceTerminologyPrecheckOperationInput,
    SourceTerminologyPrecheckWorkerInput,
    SourceTerminologyPrecheckJobResult
  >;

  constructor(options: SourceTerminologyPrecheckWorkerRunnerOptions) {
    this.runner = new WorkerBackedFileOperationRunner({
      dbPath: options.dbPath,
      operationLabel: 'SourceTerminologyPrecheck',
      workerDescription: 'Source terminology precheck worker',
      workerPathCandidates: options.workerPathCandidates ?? [
        join(__dirname, 'sourceTerminologyPrecheckWorker.js'),
        join(__dirname, '../sourceTerminologyPrecheckWorker.js'),
        join(__dirname, '../../sourceTerminologyPrecheckWorker.js'),
      ],
      buildWorkerInput: (dbPath, precheckInput) => ({ dbPath, precheckInput }),
      workerFactory: options.workerFactory,
      fallbackRunner: options.fallbackRunner,
      cancellationMessage: { type: 'cancel' },
    });
  }

  public run(
    input: SourceTerminologyPrecheckOperationInput,
  ): Promise<SourceTerminologyPrecheckJobResult> {
    return this.runner.run(input);
  }
}
