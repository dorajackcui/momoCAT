import { join } from 'path';
import {
  WorkerBackedFileOperationRunner,
  type FileOperationWorkerFactory,
  type FileOperationWorkerMessage,
} from '../../workers/WorkerBackedFileOperationRunner';

export interface WorkingTMResetWorkerInput {
  dbPath: string;
  tmId: string;
}

export type WorkingTMResetWorkerMessage = FileOperationWorkerMessage<number>;

interface WorkingTMResetWorkerRunnerOptions {
  dbPath: string;
  workerFactory?: FileOperationWorkerFactory<
    WorkingTMResetWorkerInput,
    WorkingTMResetWorkerMessage
  >;
  workerPathCandidates?: string[];
}

interface WorkingTMResetInput {
  tmId: string;
  onProgress?: (current: number, total: number) => void;
}

export interface WorkingTMResetRunner {
  run(tmId: string): Promise<number>;
}

export class WorkingTMResetWorkerRunner implements WorkingTMResetRunner {
  private readonly runner: WorkerBackedFileOperationRunner<
    WorkingTMResetInput,
    WorkingTMResetWorkerInput,
    number
  >;

  constructor(options: WorkingTMResetWorkerRunnerOptions) {
    this.runner = new WorkerBackedFileOperationRunner<
      WorkingTMResetInput,
      WorkingTMResetWorkerInput,
      number
    >({
      dbPath: options.dbPath,
      operationLabel: 'WorkingTMReset',
      workerDescription: 'Working TM reset worker',
      workerPathCandidates: options.workerPathCandidates ?? [
        join(__dirname, 'workingTMResetWorker.js'),
        join(__dirname, '../workingTMResetWorker.js'),
        join(__dirname, '../../workingTMResetWorker.js'),
      ],
      buildWorkerInput: (dbPath, input) => ({ dbPath, tmId: input.tmId }),
      workerFactory: options.workerFactory,
    });
  }

  public run(tmId: string): Promise<number> {
    return this.runner.run({ tmId });
  }
}
