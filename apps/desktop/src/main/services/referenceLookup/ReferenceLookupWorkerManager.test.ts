import { EventEmitter } from 'events';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMConcordanceEntry, TMMatch } from '../../../shared/ipc';
import { ReferenceLookupWorkerManager } from './ReferenceLookupWorkerManager';
import type { ReferenceLookupWorkerResponse } from './types';

interface WorkerFactoryOptions {
  workerData: {
    dbPath: string;
  };
}

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
  public readonly terminate = vi.fn(async () => 0);
}

const WORKER_PATH = join(process.cwd(), 'apps/desktop/src/main/services/referenceLookup/types.ts');
const WORKER_OPTIONS: WorkerFactoryOptions = { workerData: { dbPath: 'cat.db' } };

function createSegment(segmentId = 'seg-1'): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Source' }],
    targetTokens: [],
    status: 'new',
    matchKey: 'source',
    srcHash: 'hash',
    tagsSignature: '',
    meta: { updatedAt: '2026-07-02T00:00:00.000Z' },
  };
}

function tmMatches(id: string): TMMatch[] {
  return [{ id }] as unknown as TMMatch[];
}

function tbMatches(id: string): TBMatch[] {
  return [{ id }] as unknown as TBMatch[];
}

function concordanceEntries(id: string): TMConcordanceEntry[] {
  return [{ id }] as unknown as TMConcordanceEntry[];
}

function createWorkerFactory(workers: MockWorker[]) {
  return vi.fn((_workerPath: string, _options: WorkerFactoryOptions) => {
    const worker = new MockWorker();
    workers.push(worker);
    return worker;
  });
}

function createManager() {
  const workers: MockWorker[] = [];
  const workerFactory = createWorkerFactory(workers);
  const manager = new ReferenceLookupWorkerManager({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates: [WORKER_PATH],
  });
  return { manager, workers, workerFactory };
}

async function waitForWorkerStart(
  workers: MockWorker[],
  workerFactory: ReturnType<typeof createWorkerFactory>,
  callNumber = 1,
): Promise<MockWorker> {
  await vi.waitFor(() => {
    expect(workerFactory).toHaveBeenNthCalledWith(callNumber, WORKER_PATH, WORKER_OPTIONS);
    expect(workers).toHaveLength(callNumber);
  });
  return workers[callNumber - 1]!;
}

describe('ReferenceLookupWorkerManager', () => {
  it('constructs the worker and sends complete TM request messages', async () => {
    const { manager, workers, workerFactory } = createManager();
    const segment = createSegment();
    const promise = manager.findTmMatches(7, segment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment,
      });
    });

    const result = tmMatches('tm-1');
    worker.emit('message', {
      requestId: 1,
      ok: true,
      kind: 'tm',
      result,
    } satisfies ReferenceLookupWorkerResponse);

    await expect(promise).resolves.toEqual(result);
  });

  it('supports complete TB and Concordance request messages', async () => {
    const { manager, workers, workerFactory } = createManager();
    const segment = createSegment('tb-seg');
    const tbPromise = manager.findTbMatches(7, segment);
    const concordancePromise = manager.searchConcordance(7, 'query');
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
        requestId: 1,
        kind: 'tb',
        projectId: 7,
        segment,
      });
      expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
        requestId: 2,
        kind: 'concordance',
        projectId: 7,
        query: 'query',
      });
    });

    worker.emit('message', { requestId: 1, ok: true, kind: 'tb', result: [] });
    worker.emit('message', { requestId: 2, ok: true, kind: 'concordance', result: [] });

    await expect(tbPromise).resolves.toEqual([]);
    await expect(concordancePromise).resolves.toEqual([]);
  });

  it('resolves responses by request id when they arrive out of order', async () => {
    const { manager, workers, workerFactory } = createManager();
    const firstSegment = createSegment('first');
    const secondSegment = createSegment('second');
    const first = manager.findTmMatches(7, firstSegment);
    const second = manager.findTbMatches(7, secondSegment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment: firstSegment,
      });
      expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
        requestId: 2,
        kind: 'tb',
        projectId: 7,
        segment: secondSegment,
      });
    });

    const secondResult = tbMatches('tb-second');
    worker.emit('message', {
      requestId: 2,
      ok: true,
      kind: 'tb',
      result: secondResult,
    } satisfies ReferenceLookupWorkerResponse);
    await expect(second).resolves.toEqual(secondResult);

    const firstResult = tmMatches('tm-first');
    worker.emit('message', {
      requestId: 1,
      ok: true,
      kind: 'tm',
      result: firstResult,
    } satisfies ReferenceLookupWorkerResponse);
    await expect(first).resolves.toEqual(firstResult);
  });

  it('rejects matching requests on worker error responses and ignores unknown ids', async () => {
    const { manager, workers, workerFactory } = createManager();
    const segment = createSegment();
    const promise = manager.findTmMatches(7, segment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment,
      });
    });

    worker.emit('message', { requestId: 99, ok: true, kind: 'tm', result: [] });
    worker.emit('message', {
      requestId: 1,
      ok: false,
      kind: 'tm',
      error: 'lookup failed',
    });

    await expect(promise).rejects.toThrow('lookup failed');
  });

  it('rejects all pending requests on worker errors and lazy restarts next time', async () => {
    const { manager, workers, workerFactory } = createManager();
    const firstSegment = createSegment('a');
    const secondSegment = createSegment('b');
    const first = manager.findTmMatches(7, firstSegment);
    const second = manager.findTbMatches(7, secondSegment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment: firstSegment,
      });
      expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
        requestId: 2,
        kind: 'tb',
        projectId: 7,
        segment: secondSegment,
      });
    });

    worker.emit('error', new Error('worker died'));
    await expect(first).rejects.toThrow('worker died');
    await expect(second).rejects.toThrow('worker died');

    const next = manager.searchConcordance(7, 'query');
    const restartedWorker = await waitForWorkerStart(workers, workerFactory, 2);
    await vi.waitFor(() => {
      expect(restartedWorker.postMessage).toHaveBeenCalledWith({
        requestId: 3,
        kind: 'concordance',
        projectId: 7,
        query: 'query',
      });
    });
    restartedWorker.emit('message', {
      requestId: 3,
      ok: true,
      kind: 'concordance',
      result: [],
    });
    await expect(next).resolves.toEqual([]);
  });

  it('rejects all pending requests on non-zero worker exit and lazy restarts next time', async () => {
    const { manager, workers, workerFactory } = createManager();
    const firstSegment = createSegment('exit-a');
    const secondSegment = createSegment('exit-b');
    const first = manager.findTmMatches(7, firstSegment);
    const second = manager.findTbMatches(7, secondSegment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment: firstSegment,
      });
      expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
        requestId: 2,
        kind: 'tb',
        projectId: 7,
        segment: secondSegment,
      });
    });

    worker.emit('exit', 1);
    await expect(first).rejects.toThrow('Reference lookup worker exited with code 1');
    await expect(second).rejects.toThrow('Reference lookup worker exited with code 1');

    const result = concordanceEntries('conc-after-exit');
    const next = manager.searchConcordance(7, 'query');
    const restartedWorker = await waitForWorkerStart(workers, workerFactory, 2);
    await vi.waitFor(() => {
      expect(restartedWorker.postMessage).toHaveBeenCalledWith({
        requestId: 3,
        kind: 'concordance',
        projectId: 7,
        query: 'query',
      });
    });
    restartedWorker.emit('message', {
      requestId: 3,
      ok: true,
      kind: 'concordance',
      result,
    } satisfies ReferenceLookupWorkerResponse);
    await expect(next).resolves.toEqual(result);
  });

  it('rejects requests when worker startup fails instead of falling back', async () => {
    const startupError = new Error('worker startup failed');
    const workerFactory = vi.fn((_workerPath: string, _options: WorkerFactoryOptions) => {
      throw startupError;
    });
    const manager = new ReferenceLookupWorkerManager({
      dbPath: 'cat.db',
      workerFactory,
      workerPathCandidates: [WORKER_PATH],
    });

    const promise = manager.findTmMatches(7, createSegment());
    const rejection = expect(promise).rejects.toThrow('worker startup failed');

    await vi.waitFor(() => {
      expect(workerFactory).toHaveBeenCalledWith(WORKER_PATH, WORKER_OPTIONS);
    });
    await rejection;
  });

  it('terminates the worker and rejects pending requests on dispose', async () => {
    const { manager, workers, workerFactory } = createManager();
    const segment = createSegment();
    const pending = manager.findTmMatches(7, segment);
    const worker = await waitForWorkerStart(workers, workerFactory);

    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        requestId: 1,
        kind: 'tm',
        projectId: 7,
        segment,
      });
    });

    await manager.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('Reference lookup worker disposed');
  });

  it('invalidateReferenceData is a no-op when no worker has been started', async () => {
    const { manager, workerFactory } = createManager();

    await manager.invalidateReferenceData();

    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('invalidateReferenceData sends an invalidate request to a live worker', async () => {
    const { manager, workers, workerFactory } = createManager();
    const segment = createSegment();
    const warm = manager.findTmMatches(7, segment);
    const worker = await waitForWorkerStart(workers, workerFactory);
    worker.emit('message', {
      requestId: 1,
      ok: true,
      kind: 'tm',
      result: [],
    } satisfies ReferenceLookupWorkerResponse);
    await warm;

    const invalidate = manager.invalidateReferenceData();
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({ requestId: 2, kind: 'invalidate' });
    });
    worker.emit('message', {
      requestId: 2,
      ok: true,
      kind: 'invalidate',
      result: null,
    } satisfies ReferenceLookupWorkerResponse);

    await expect(invalidate).resolves.toBeUndefined();
    expect(workerFactory).toHaveBeenCalledTimes(1);
  });
});
