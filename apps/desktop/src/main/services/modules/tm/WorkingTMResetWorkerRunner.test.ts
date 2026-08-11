import { EventEmitter } from 'events';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { WorkingTMResetWorkerRunner } from './WorkingTMResetWorkerRunner';
import type { WorkingTMResetWorkerInput } from './WorkingTMResetWorkerRunner';

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
}

const WORKER_PATH = join(process.cwd(), 'apps/desktop/src/main/workingTMResetWorker.ts');

function createRunner(workerPathCandidates = [WORKER_PATH]) {
  const workers: MockWorker[] = [];
  const workerFactory = vi.fn(
    (workerPath: string, options: { workerData: WorkingTMResetWorkerInput }) => {
      void workerPath;
      void options;
      const worker = new MockWorker();
      workers.push(worker);
      return worker;
    },
  );
  const runner = new WorkingTMResetWorkerRunner({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates,
  });
  return { runner, workers, workerFactory };
}

describe('WorkingTMResetWorkerRunner', () => {
  it('runs reset off the main thread and resolves the removed count', async () => {
    const { runner, workers, workerFactory } = createRunner();
    const promise = runner.run('working-1');

    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('message', { type: 'done', result: 426 });

    await expect(promise).resolves.toBe(426);
    expect(workerFactory).toHaveBeenCalledWith(WORKER_PATH, {
      workerData: { dbPath: 'cat.db', tmId: 'working-1' },
    });
  });

  it('does not fall back to a blocking main-thread reset', async () => {
    const missingPath = join(process.cwd(), 'missing-working-tm-reset-worker.js');
    const { runner, workerFactory } = createRunner([missingPath]);

    await expect(runner.run('working-1')).rejects.toThrow('Working TM reset worker not found');
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
