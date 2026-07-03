import { EventEmitter } from 'events';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ExportReferencesForMtInput } from '@cat/localization';
import { ReferenceExportWorkerRunner } from './ReferenceExportWorkerRunner';
import type { ReferenceExportJobResult, ReferenceExportWorkerInput } from './types';

class MockWorker extends EventEmitter {}

const WORKER_PATH = join(process.cwd(), 'apps/desktop/src/main/services/referenceExport/types.ts');

const JOB_RESULT: ReferenceExportJobResult = {
  outputPath: 'D:/out/references.xlsx',
  summary: { total: 3, ready: 3, error: 0 },
};

function createInput(
  onProgress?: (current: number, total: number) => void,
): ExportReferencesForMtInput {
  return {
    projectId: 7,
    inputPath: 'D:/in/source.xlsx',
    outputPath: 'D:/out/references.xlsx',
    columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    onProgress,
  };
}

function createRunner(overrides?: {
  workerPathCandidates?: string[];
  fallbackRunner?: (input: ExportReferencesForMtInput) => Promise<ReferenceExportJobResult>;
}) {
  const workers: MockWorker[] = [];
  const factoryOptions: Array<{ workerData: ReferenceExportWorkerInput }> = [];
  const workerFactory = vi.fn(
    (_workerPath: string, options: { workerData: ReferenceExportWorkerInput }) => {
      factoryOptions.push(options);
      const worker = new MockWorker();
      workers.push(worker);
      return worker;
    },
  );
  const runner = new ReferenceExportWorkerRunner({
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

describe('ReferenceExportWorkerRunner', () => {
  it('spawns the worker without onProgress in workerData and resolves on done', async () => {
    const { runner, workers, workerFactory, factoryOptions } = createRunner();
    const onProgress = vi.fn();
    const promise = runner.run(createInput(onProgress));
    const worker = await waitForWorker(workers);

    expect(workerFactory).toHaveBeenCalledWith(WORKER_PATH, expect.anything());
    expect(factoryOptions[0]?.workerData).toEqual({
      dbPath: 'cat.db',
      exportInput: {
        projectId: 7,
        inputPath: 'D:/in/source.xlsx',
        outputPath: 'D:/out/references.xlsx',
        columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
      },
    });

    worker.emit('message', { type: 'progress', current: 1, total: 3 });
    worker.emit('message', { type: 'done', result: JOB_RESULT });

    await expect(promise).resolves.toEqual(JOB_RESULT);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
  });

  it('rejects when the worker reports an export error', async () => {
    const { runner, workers } = createRunner();
    const promise = runner.run(createInput());
    const worker = await waitForWorker(workers);

    worker.emit('message', { type: 'error', error: 'Source workbook not found' });

    await expect(promise).rejects.toThrow('Source workbook not found');
  });

  it('rejects when the worker exits before returning a result', async () => {
    const { runner, workers } = createRunner();
    const promise = runner.run(createInput());
    const worker = await waitForWorker(workers);

    worker.emit('exit', 1);

    await expect(promise).rejects.toThrow('Reference export worker exited with code 1');
  });

  it('does not fall back when a started worker fails', async () => {
    const fallbackRunner = vi.fn(async () => JOB_RESULT);
    const { runner, workers } = createRunner({ fallbackRunner });
    const promise = runner.run(createInput());
    const worker = await waitForWorker(workers);

    worker.emit('message', { type: 'error', error: 'xlsx write failed' });

    await expect(promise).rejects.toThrow('xlsx write failed');
    expect(fallbackRunner).not.toHaveBeenCalled();
  });

  it('falls back to the main-thread runner when the worker script is missing', async () => {
    const fallbackRunner = vi.fn(async () => JOB_RESULT);
    const { runner, workerFactory } = createRunner({
      workerPathCandidates: [join(process.cwd(), 'missing-reference-export-worker.js')],
      fallbackRunner,
    });
    const input = createInput();

    await expect(runner.run(input)).resolves.toEqual(JOB_RESULT);
    expect(fallbackRunner).toHaveBeenCalledWith(input);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('rejects when the worker script is missing and no fallback is configured', async () => {
    const { runner } = createRunner({
      workerPathCandidates: [join(process.cwd(), 'missing-reference-export-worker.js')],
    });

    await expect(runner.run(createInput())).rejects.toThrow('Reference export worker not found');
  });
});
