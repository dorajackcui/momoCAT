import { EventEmitter } from 'events';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkingTMExportWorkerRunner,
  type WorkingTMExportWorkerInput,
} from './WorkingTMExportWorkerRunner';

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
}

const WORKER_PATH = join(process.cwd(), 'apps/desktop/src/main/workingTMExportWorker.ts');

function createRunner(workerPathCandidates = [WORKER_PATH]) {
  const workers: MockWorker[] = [];
  const workerFactory = vi.fn(
    (workerPath: string, options: { workerData: WorkingTMExportWorkerInput }) => {
      void workerPath;
      void options;
      const worker = new MockWorker();
      workers.push(worker);
      return worker;
    },
  );
  const runner = new WorkingTMExportWorkerRunner({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates,
  });
  return { runner, workers, workerFactory };
}

describe('WorkingTMExportWorkerRunner', () => {
  it('runs the complete export off the main thread', async () => {
    const { runner, workers, workerFactory } = createRunner();
    const promise = runner.run('working-1', 'D:/exports/working.xlsx');

    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('message', { type: 'done', result: 426 });

    await expect(promise).resolves.toBe(426);
    expect(workerFactory).toHaveBeenCalledWith(WORKER_PATH, {
      workerData: {
        dbPath: 'cat.db',
        tmId: 'working-1',
        outputPath: 'D:/exports/working.xlsx',
      },
    });
  });

  it('does not fall back to a blocking main-thread export', async () => {
    const missingPath = join(process.cwd(), 'missing-working-tm-export-worker.js');
    const { runner, workerFactory } = createRunner([missingPath]);

    await expect(runner.run('working-1', 'working.xlsx')).rejects.toThrow(
      'Working TM export worker not found',
    );
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
