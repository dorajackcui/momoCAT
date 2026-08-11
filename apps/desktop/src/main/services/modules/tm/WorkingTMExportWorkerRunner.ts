import { join } from 'path';
import {
  WorkerBackedFileOperationRunner,
  type FileOperationWorkerFactory,
  type FileOperationWorkerMessage,
} from '../../workers/WorkerBackedFileOperationRunner';

export interface WorkingTMExportWorkerInput {
  dbPath: string;
  tmId: string;
  outputPath: string;
}

export type WorkingTMExportWorkerMessage = FileOperationWorkerMessage<number>;

interface WorkingTMExportInput {
  tmId: string;
  outputPath: string;
  onProgress?: (current: number, total: number) => void;
}

interface WorkingTMExportWorkerRunnerOptions {
  dbPath: string;
  workerFactory?: FileOperationWorkerFactory<
    WorkingTMExportWorkerInput,
    WorkingTMExportWorkerMessage
  >;
  workerPathCandidates?: string[];
}

export interface WorkingTMExportRunner {
  run(tmId: string, outputPath: string): Promise<number>;
}

export class WorkingTMExportWorkerRunner implements WorkingTMExportRunner {
  private readonly runner: WorkerBackedFileOperationRunner<
    WorkingTMExportInput,
    WorkingTMExportWorkerInput,
    number
  >;

  constructor(options: WorkingTMExportWorkerRunnerOptions) {
    this.runner = new WorkerBackedFileOperationRunner<
      WorkingTMExportInput,
      WorkingTMExportWorkerInput,
      number
    >({
      dbPath: options.dbPath,
      operationLabel: 'WorkingTMExport',
      workerDescription: 'Working TM export worker',
      workerPathCandidates: options.workerPathCandidates ?? [
        join(__dirname, 'workingTMExportWorker.js'),
        join(__dirname, '../workingTMExportWorker.js'),
        join(__dirname, '../../workingTMExportWorker.js'),
      ],
      buildWorkerInput: (dbPath, input) => ({ dbPath, ...input }),
      workerFactory: options.workerFactory,
    });
  }

  public run(tmId: string, outputPath: string): Promise<number> {
    return this.runner.run({ tmId, outputPath });
  }
}
