import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import {
  createReferenceLookupControllerLoader,
  createReferenceLookupScheduler,
} from './useReferenceLookupController';

function createSegment(segmentId: string, srcHash: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: `Source ${segmentId}` }],
    targetTokens: [],
    status: 'new',
    matchKey: `source-${segmentId}`,
    srcHash,
    tagsSignature: '',
    meta: { updatedAt: '2026-07-02T00:00:00.000Z' },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('createReferenceLookupControllerLoader', () => {
  it('caches completed TM and TB matches by project and source hash', async () => {
    const tmMatches = [{ id: 'tm-1' }] as TMMatch[];
    const tbMatches = [{ id: 'tb-1' }] as TBMatch[];
    const getMatches = vi.fn(async () => tmMatches);
    const getTermMatches = vi.fn(async () => tbMatches);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    const first = await loader.load({ projectId: 7, segment: createSegment('seg-1', 'same') });
    const second = await loader.load({ projectId: 7, segment: createSegment('seg-2', 'same') });

    expect(first).toEqual({ matches: tmMatches, terms: tbMatches });
    expect(second).toBe(first);
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getTermMatches).toHaveBeenCalledTimes(1);
  });

  it('invalidates one source hash without discarding neighboring prefetched results', async () => {
    const getMatches = vi.fn(
      async (_projectId: number, segment: Segment) =>
        [{ id: `tm-${segment.srcHash}` }] as TMMatch[],
    );
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });
    const changed = createSegment('seg-a', 'hash-a');
    const neighbor = createSegment('seg-b', 'hash-b');

    await loader.load({ projectId: 7, segment: changed, prefetch: true });
    const cachedNeighbor = await loader.load({ projectId: 7, segment: neighbor, prefetch: true });
    expect(getMatches).toHaveBeenCalledTimes(2);

    loader.invalidateSource(7, 'hash-a');

    await expect(loader.load({ projectId: 7, segment: neighbor })).resolves.toBe(cachedNeighbor);
    expect(getMatches).toHaveBeenCalledTimes(2);

    await loader.load({ projectId: 7, segment: changed });
    expect(getMatches).toHaveBeenCalledTimes(3);
  });

  it('deduplicates in-flight loads for the same project and source hash', async () => {
    const tmDeferred = deferred<TMMatch[]>();
    const tbDeferred = deferred<TBMatch[]>();
    const getMatches = vi.fn(() => tmDeferred.promise);
    const getTermMatches = vi.fn(() => tbDeferred.promise);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    const first = loader.load({ projectId: 7, segment: createSegment('seg-1', 'same') });
    const second = loader.load({ projectId: 7, segment: createSegment('seg-2', 'same') });
    expect(second).toBe(first);

    tmDeferred.resolve([{ id: 'tm-1' }] as TMMatch[]);
    tbDeferred.resolve([{ id: 'tb-1' }] as TBMatch[]);
    await expect(first).resolves.toEqual({
      matches: [{ id: 'tm-1' }],
      terms: [{ id: 'tb-1' }],
    });
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getTermMatches).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer same-key in-flight load when an invalidated older load settles', async () => {
    const firstTm = deferred<TMMatch[]>();
    const firstTb = deferred<TBMatch[]>();
    const secondTm = deferred<TMMatch[]>();
    const secondTb = deferred<TBMatch[]>();
    const getMatches = vi
      .fn()
      .mockImplementationOnce(() => firstTm.promise)
      .mockImplementationOnce(() => secondTm.promise);
    const getTermMatches = vi
      .fn()
      .mockImplementationOnce(() => firstTb.promise)
      .mockImplementationOnce(() => secondTb.promise);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    const first = loader.load({ projectId: 7, segment: createSegment('seg-1', 'same') });
    loader.invalidateProject(7);
    const second = loader.load({ projectId: 7, segment: createSegment('seg-2', 'same') });

    firstTm.resolve([{ id: 'tm-old' }] as TMMatch[]);
    firstTb.resolve([{ id: 'tb-old' }] as TBMatch[]);
    await expect(first).resolves.toEqual({
      matches: [{ id: 'tm-old' }],
      terms: [{ id: 'tb-old' }],
    });

    const third = loader.load({ projectId: 7, segment: createSegment('seg-3', 'same') });
    expect(third).toBe(second);
    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(getTermMatches).toHaveBeenCalledTimes(2);

    secondTm.resolve([{ id: 'tm-new' }] as TMMatch[]);
    secondTb.resolve([{ id: 'tb-new' }] as TBMatch[]);
    await expect(second).resolves.toEqual({
      matches: [{ id: 'tm-new' }],
      terms: [{ id: 'tb-new' }],
    });
  });

  it('keeps fulfilled TM matches when TB lookup fails and does not cache partial failures', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-1' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => {
      throw new Error('tb unavailable');
    });
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    await expect(
      loader.load({ projectId: 7, segment: createSegment('seg-1', 'hash') }),
    ).resolves.toEqual({ matches: [{ id: 'tm-1' }], terms: [] });
    await loader.load({ projectId: 7, segment: createSegment('seg-2', 'hash') });

    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(getTermMatches).toHaveBeenCalledTimes(2);
  });

  it('keeps fulfilled TB matches when TM lookup fails and does not cache partial failures', async () => {
    const getMatches = vi.fn(async () => {
      throw new Error('tm unavailable');
    });
    const getTermMatches = vi.fn(async () => [{ id: 'tb-1' }] as TBMatch[]);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    await expect(
      loader.load({ projectId: 7, segment: createSegment('seg-1', 'hash') }),
    ).resolves.toEqual({ matches: [], terms: [{ id: 'tb-1' }] });
    await loader.load({ projectId: 7, segment: createSegment('seg-2', 'hash') });

    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(getTermMatches).toHaveBeenCalledTimes(2);
  });
});

describe('createReferenceLookupScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fetch when disabled and clears results', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-1' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [{ id: 'tb-1' }] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({
      enabled: false,
      projectId: 7,
      segment: createSegment('seg-1', 'hash'),
    });
    await vi.runAllTimersAsync();

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] }, false);
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
  });

  it('clears a queued lookup when disabled before the debounce expires', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-1' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [{ id: 'tb-1' }] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({
      enabled: true,
      projectId: 7,
      segment: createSegment('seg-1', 'hash'),
    });
    scheduler.update({
      enabled: false,
      projectId: 7,
      segment: createSegment('seg-1', 'hash'),
    });
    await vi.advanceTimersByTimeAsync(350);

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] }, false);
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
  });

  it('does not publish an already running lookup after being disabled', async () => {
    const tmDeferred = deferred<TMMatch[]>();
    let firstSettled = false;
    const getMatches = vi.fn(() =>
      tmDeferred.promise.finally(() => {
        firstSettled = true;
      }),
    );
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    scheduler.update({ enabled: false, projectId: 7, segment: createSegment('a', 'hash-a') });

    tmDeferred.resolve([{ id: 'tm-a' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(firstSettled).toBe(true);
    });

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] }, false);
    expect(setResult).not.toHaveBeenCalledWith({ matches: [{ id: 'tm-a' }], terms: [] }, false);
  });

  it('does not publish the current in-flight lookup after invalidation', async () => {
    const first = deferred<TMMatch[]>();
    const second = deferred<TMMatch[]>();
    let firstSettled = false;
    const getMatches = vi
      .fn()
      .mockImplementationOnce(() =>
        first.promise.finally(() => {
          firstSettled = true;
        }),
      )
      .mockImplementationOnce(() => second.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    scheduler.invalidate(7);

    first.resolve([{ id: 'tm-a-stale' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(firstSettled).toBe(true);
    });

    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(setResult).not.toHaveBeenCalledWith({
      matches: [{ id: 'tm-a-stale' }],
      terms: [],
    }, false);
  });

  it('invalidates cached current results and refetches when reference data changes', async () => {
    const getMatches = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'tm-first' }] as TMMatch[])
      .mockResolvedValueOnce([{ id: 'tm-second' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });
    const segment = createSegment('seg-1', 'hash');

    scheduler.update({
      enabled: true,
      projectId: 7,
      segment,
    });
    await vi.advanceTimersByTimeAsync(350);
    expect(setResult).toHaveBeenLastCalledWith({
      matches: [{ id: 'tm-first' }],
      terms: [],
    }, false);

    scheduler.invalidate(7);
    await vi.advanceTimersByTimeAsync(350);

    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(setResult).toHaveBeenLastCalledWith({
      matches: [{ id: 'tm-second' }],
      terms: [],
    }, false);
  });

  it('ignores unrelated project invalidation for the current in-flight lookup', async () => {
    const tmDeferred = deferred<TMMatch[]>();
    let firstSettled = false;
    const getMatches = vi.fn(() =>
      tmDeferred.promise.finally(() => {
        firstSettled = true;
      }),
    );
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    scheduler.invalidate(8);
    await vi.advanceTimersByTimeAsync(350);

    tmDeferred.resolve([{ id: 'tm-a' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(firstSettled).toBe(true);
    });

    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(setResult).toHaveBeenLastCalledWith({ matches: [{ id: 'tm-a' }], terms: [] }, false);
  });

  it('queues a fresh same-key lookup when current in-flight data is invalidated', async () => {
    const first = deferred<TMMatch[]>();
    const second = deferred<TMMatch[]>();
    const getMatches = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    scheduler.invalidate(7);
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    first.resolve([{ id: 'tm-stale' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(getMatches).toHaveBeenCalledTimes(2);
    });
    expect(setResult).not.toHaveBeenCalledWith({
      matches: [{ id: 'tm-stale' }],
      terms: [],
    }, false);

    second.resolve([{ id: 'tm-fresh' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith({
        matches: [{ id: 'tm-fresh' }],
        terms: [],
      }, false);
    });
  });

  it('coalesces a queued segment change when invalidation arrives during another lookup', async () => {
    const a = deferred<TMMatch[]>();
    const b = deferred<TMMatch[]>();
    const getMatches = vi
      .fn()
      .mockImplementationOnce((_projectId, segment: Segment) => {
        expect(segment.segmentId).toBe('a');
        return a.promise;
      })
      .mockImplementationOnce((_projectId, segment: Segment) => {
        expect(segment.segmentId).toBe('b');
        return b.promise;
      });
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    scheduler.invalidate(7);
    a.resolve([{ id: 'tm-a-stale' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(getMatches).toHaveBeenCalledTimes(2);
    });
    expect(getMatches.mock.calls[1][1].segmentId).toBe('b');

    b.resolve([{ id: 'tm-b-fresh' }] as TMMatch[]);
    await vi.advanceTimersByTimeAsync(0);
    expect(setResult).toHaveBeenLastCalledWith({
      matches: [{ id: 'tm-b-fresh' }],
      terms: [],
    }, false);
    expect(setResult).not.toHaveBeenCalledWith({
      matches: [{ id: 'tm-a-stale' }],
      terms: [],
    }, false);
    expect(getMatches).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(2);
  });

  it('debounces rapid active changes and only fetches the latest segment', async () => {
    const getMatches = vi.fn(async (_projectId, segment: Segment) => [
      { id: `tm-${segment.segmentId}` },
    ] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult: vi.fn(),
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('c', 'hash-c') });
    await vi.advanceTimersByTimeAsync(350);

    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getMatches.mock.calls[0][1].segmentId).toBe('c');
  });

  it('runs the current in-flight lookup and then only the queued latest lookup', async () => {
    const a = deferred<TMMatch[]>();
    const d = deferred<TMMatch[]>();
    const getMatches = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => d.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('c', 'hash-c') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('d', 'hash-d') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    a.resolve([{ id: 'tm-a' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(getMatches).toHaveBeenCalledTimes(2);
    });
    expect(setResult).not.toHaveBeenCalledWith({ matches: [{ id: 'tm-a' }], terms: [] }, false);
    expect(getMatches.mock.calls[1][1].segmentId).toBe('d');

    d.resolve([{ id: 'tm-d' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith({ matches: [{ id: 'tm-d' }], terms: [] }, false);
    });
  });

  it('routes prefetch through prefetch fetchers, never the active fetchers', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-active' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const prefetchGetMatches = vi.fn(async () => [{ id: 'tm-prefetched' }] as TMMatch[]);
    const prefetchGetTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    await vi.runAllTimersAsync();

    expect(prefetchGetMatches).toHaveBeenCalledTimes(1);
    expect(prefetchGetTermMatches).toHaveBeenCalledTimes(1);
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
  });

  it('serves a prefetched segment from cache without an active fetch', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-active' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const prefetchGetMatches = vi.fn(async () => [{ id: 'tm-prefetched' }] as TMMatch[]);
    const prefetchGetTermMatches = vi.fn(async () => [{ id: 'tb-prefetched' }] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    await vi.runAllTimersAsync();

    // Navigating to the prefetched segment must be an instant cache hit.
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.runAllTimersAsync();

    expect(setResult).toHaveBeenLastCalledWith(
      { matches: [{ id: 'tm-prefetched' }], terms: [{ id: 'tb-prefetched' }] },
      false,
    );
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
  });

  it('does not let an active lookup wait behind a stuck in-flight prefetch', async () => {
    const prefetchTm = deferred<TMMatch[]>();
    const getMatches = vi.fn(async () => [{ id: 'tm-active' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    // Simulates a prefetch queued behind long work on the prefetch worker.
    const prefetchGetMatches = vi.fn(() => prefetchTm.promise);
    const prefetchGetTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.advanceTimersByTimeAsync(350);

    // The active lookup fires on the active channel instead of waiting for
    // the stuck prefetch, and its result is published immediately.
    expect(getMatches).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith(
        { matches: [{ id: 'tm-active' }], terms: [] },
        false,
      );
    });

    // The stuck prefetch settling later must not disturb anything.
    prefetchTm.resolve([{ id: 'tm-prefetched' }] as TMMatch[]);
    await vi.runAllTimersAsync();
    expect(setResult).toHaveBeenLastCalledWith({ matches: [{ id: 'tm-active' }], terms: [] }, false);
  });

  it('publishes an in-flight prefetch result when it wins the race against the active channel', async () => {
    const activeTm = deferred<TMMatch[]>();
    const getMatches = vi.fn(() => activeTm.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const prefetchGetMatches = vi.fn(async () => [{ id: 'tm-prefetched' }] as TMMatch[]);
    const prefetchGetTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.advanceTimersByTimeAsync(350);

    // Prefetch resolves first; its result is published without waiting for
    // the slower active-channel request.
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith(
        { matches: [{ id: 'tm-prefetched' }], terms: [] },
        false,
      );
    });

    activeTm.resolve([{ id: 'tm-active' }] as TMMatch[]);
    await vi.runAllTimersAsync();
  });

  it('dedupes a prefetch against an in-flight active lookup for the same segment', async () => {
    const activeTm = deferred<TMMatch[]>();
    const getMatches = vi.fn(() => activeTm.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const prefetchGetMatches = vi.fn(async () => [] as TMMatch[]);
    const prefetchGetTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    // Prefetching the segment already being actively looked up must not
    // issue a duplicate query on the prefetch channel.
    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(prefetchGetMatches).not.toHaveBeenCalled();

    activeTm.resolve([{ id: 'tm-active' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith(
        { matches: [{ id: 'tm-active' }], terms: [] },
        false,
      );
    });
  });

  it('invalidation also clears prefetched cache entries', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-active' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const prefetchGetMatches = vi.fn(async () => [{ id: 'tm-prefetched' }] as TMMatch[]);
    const prefetchGetTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      prefetchFetchers: {
        getMatches: prefetchGetMatches,
        getTermMatches: prefetchGetTermMatches,
      },
      setResult,
      debounceMs: 350,
    });

    scheduler.prefetch(7, [createSegment('b', 'hash-b')]);
    await vi.runAllTimersAsync();

    scheduler.invalidate(7);
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    await vi.runAllTimersAsync();

    // Stale prefetched data must not be served after invalidation; the
    // active channel refetches.
    expect(getMatches).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith(
        { matches: [{ id: 'tm-active' }], terms: [] },
        false,
      );
    });
  });
});
