import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { ReferenceLookupWorkerManager } from './ReferenceLookupWorkerManager';
import type { ReferenceLookupWorkerResponse } from './types';

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
  public readonly terminate = vi.fn(async () => 0);
}

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

function createManager() {
  const workers: MockWorker[] = [];
  const workerFactory = vi.fn(() => {
    const worker = new MockWorker();
    workers.push(worker);
    return worker;
  });
  const manager = new ReferenceLookupWorkerManager({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates: ['referenceLookupWorker.js'],
  });
  return { manager, workers, workerFactory };
}

describe('ReferenceLookupWorkerManager', () => {
  it('sends TM requests with unique ids and resolves matching responses', async () => {
    const { manager, workers } = createManager();
    const promise = manager.findTmMatches(7, createSegment());

    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 1, kind: 'tm', projectId: 7 }),
    );

    workers[0].emit('message', {
      requestId: 1,
      ok: true,
      kind: 'tm',
      result: [{ id: 'tm-1' }],
    } satisfies ReferenceLookupWorkerResponse);

    await expect(promise).resolves.toEqual([{ id: 'tm-1' }]);
  });

  it('supports TB and Concordance request kinds', async () => {
    const { manager, workers } = createManager();
    const tbPromise = manager.findTbMatches(7, createSegment('tb-seg'));
    const concordancePromise = manager.searchConcordance(7, 'query');

    expect(workers[0].postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestId: 1, kind: 'tb' }),
    );
    expect(workers[0].postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: 2, kind: 'concordance', query: 'query' }),
    );

    workers[0].emit('message', { requestId: 1, ok: true, kind: 'tb', result: [] });
    workers[0].emit('message', { requestId: 2, ok: true, kind: 'concordance', result: [] });

    await expect(tbPromise).resolves.toEqual([]);
    await expect(concordancePromise).resolves.toEqual([]);
  });

  it('rejects matching requests on worker error responses and ignores unknown ids', async () => {
    const { manager, workers } = createManager();
    const promise = manager.findTmMatches(7, createSegment());

    workers[0].emit('message', { requestId: 99, ok: true, kind: 'tm', result: [] });
    workers[0].emit('message', {
      requestId: 1,
      ok: false,
      kind: 'tm',
      error: 'lookup failed',
    });

    await expect(promise).rejects.toThrow('lookup failed');
  });

  it('rejects all pending requests on crash and lazy restarts next time', async () => {
    const { manager, workers, workerFactory } = createManager();
    const first = manager.findTmMatches(7, createSegment('a'));
    const second = manager.findTbMatches(7, createSegment('b'));

    workers[0].emit('error', new Error('worker died'));
    await expect(first).rejects.toThrow('worker died');
    await expect(second).rejects.toThrow('worker died');

    const next = manager.searchConcordance(7, 'query');
    expect(workerFactory).toHaveBeenCalledTimes(2);
    workers[1].emit('message', { requestId: 3, ok: true, kind: 'concordance', result: [] });
    await expect(next).resolves.toEqual([]);
  });

  it('terminates the worker and rejects pending requests on dispose', async () => {
    const { manager, workers } = createManager();
    const pending = manager.findTmMatches(7, createSegment());

    await manager.dispose();

    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('Reference lookup worker disposed');
  });
});
