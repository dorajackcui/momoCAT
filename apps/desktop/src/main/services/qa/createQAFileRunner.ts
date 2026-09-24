import { join } from 'path';
import type { FileQaReport } from '@cat/core/project';
import { WorkerBackedFileOperationRunner } from '../workers/WorkerBackedFileOperationRunner';

export interface QAWorkerInput {
  dbPath: string;
  fileId: number;
}

export function createQAFileRunner(dbPath: string) {
  const runner = new WorkerBackedFileOperationRunner<
    { fileId: number },
    QAWorkerInput,
    FileQaReport
  >({
    dbPath,
    operationLabel: 'QA',
    workerDescription: 'QA worker',
    workerPathCandidates: [
      join(__dirname, 'qaWorker.js'),
      join(__dirname, '../qaWorker.js'),
      join(__dirname, '../../qaWorker.js'),
    ],
    buildWorkerInput: (dbPath, input) => ({ dbPath, ...input }),
  });
  const running = new Map<number, Promise<FileQaReport>>();
  return (fileId: number) => {
    const existing = running.get(fileId);
    if (existing) return existing;
    const job = runner.run({ fileId }).finally(() => running.delete(fileId));
    running.set(fileId, job);
    return job;
  };
}
