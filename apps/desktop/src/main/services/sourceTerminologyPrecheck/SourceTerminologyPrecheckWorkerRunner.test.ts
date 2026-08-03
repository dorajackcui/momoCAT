import { EventEmitter } from 'events';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { SourceTerminologyPrecheckWorkerRunner } from './SourceTerminologyPrecheckWorkerRunner';
import type {
  SourceTerminologyPrecheckJobResult,
  SourceTerminologyPrecheckOperationInput,
  SourceTerminologyPrecheckWorkerInput,
} from './types';

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
}

const WORKER_PATH = join(
  process.cwd(),
  'apps/desktop/src/main/services/sourceTerminologyPrecheck/types.ts',
);

const JOB_RESULT: SourceTerminologyPrecheckJobResult = {
  outputPath: 'D:/out/source-terms.xlsx',
  summary: { total: 3, ready: 3, error: 0, cancelled: 0, uniqueTerms: 2 },
};

function createInput(
  onProgress?: (current: number, total: number) => void,
): SourceTerminologyPrecheckOperationInput {
  return {
    projectId: 7,
    inputPath: 'D:/in/source.xlsx',
    outputPath: 'D:/out/source-terms.xlsx',
    columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    onProgress,
  };
}

function createRunner(overrides?: {
  workerPathCandidates?: string[];
  fallbackRunner?: (
    input: SourceTerminologyPrecheckOperationInput,
  ) => Promise<SourceTerminologyPrecheckJobResult>;
}) {
  const workers: MockWorker[] = [];
  const factoryOptions: Array<{ workerData: SourceTerminologyPrecheckWorkerInput }> = [];
  const workerFactory = vi.fn(
    (_workerPath: string, options: { workerData: SourceTerminologyPrecheckWorkerInput }) => {
      factoryOptions.push(options);
      const worker = new MockWorker();
      workers.push(worker);
      return worker;
    },
  );
  const runner = new SourceTerminologyPrecheckWorkerRunner({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates: overrides?.workerPathCandidates ?? [WORKER_PATH],
    fallbackRunner: overrides?.fallbackRunner,
  });
  return { runner, workers, workerFactory, factoryOptions };
}

async function waitForWorker(workers: MockWorker[]): Promise<MockWorker> {
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  return workers[0]!;
}

describe('SourceTerminologyPrecheckWorkerRunner', () => {
  it('spawns the worker without onProgress and forwards progress messages', async () => {
    const { runner, workers, factoryOptions } = createRunner();
    const onProgress = vi.fn();
    const promise = runner.run(createInput(onProgress));
    const worker = await waitForWorker(workers);

    expect(factoryOptions[0]?.workerData).toEqual({
      dbPath: 'cat.db',
      precheckInput: {
        projectId: 7,
        inputPath: 'D:/in/source.xlsx',
        outputPath: 'D:/out/source-terms.xlsx',
        columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
      },
    });

    worker.emit('message', { type: 'progress', current: 1, total: 3 });
    worker.emit('message', { type: 'done', result: JOB_RESULT });

    await expect(promise).resolves.toEqual(JOB_RESULT);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
  });

  it('does not fall back after a started worker reports an error', async () => {
    const fallbackRunner = vi.fn(async () => JOB_RESULT);
    const { runner, workers } = createRunner({ fallbackRunner });
    const promise = runner.run(createInput());
    const worker = await waitForWorker(workers);

    worker.emit('message', { type: 'error', error: 'provider failed' });

    await expect(promise).rejects.toThrow('provider failed');
    expect(fallbackRunner).not.toHaveBeenCalled();
  });

  it('forwards cancellation to the active worker without cloning the token', async () => {
    const { runner, workers, factoryOptions } = createRunner();
    let requested = false;
    let listener: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: () => requested,
      onCancellationRequested: (nextListener: () => void) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    };
    const promise = runner.run({ ...createInput(), cancellationToken });
    const worker = await waitForWorker(workers);

    expect(factoryOptions[0]?.workerData.precheckInput).not.toHaveProperty('cancellationToken');
    requested = true;
    listener?.();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel' });

    worker.emit('message', {
      type: 'done',
      result: {
        ...JOB_RESULT,
        summary: { ...JOB_RESULT.summary, ready: 1, cancelled: 2 },
      },
    });
    await expect(promise).resolves.toMatchObject({ summary: { ready: 1, cancelled: 2 } });
  });

  it('falls back only when the worker script is missing', async () => {
    const fallbackRunner = vi.fn(async () => JOB_RESULT);
    const { runner, workerFactory } = createRunner({
      workerPathCandidates: [join(process.cwd(), 'missing-source-terminology-worker.js')],
      fallbackRunner,
    });
    const input = createInput();

    await expect(runner.run(input)).resolves.toEqual(JOB_RESULT);
    expect(fallbackRunner).toHaveBeenCalledWith(input);
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
