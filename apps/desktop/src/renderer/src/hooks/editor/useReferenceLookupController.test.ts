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

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] });
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

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] });
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
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
    expect(setResult).not.toHaveBeenCalledWith({ matches: [{ id: 'tm-a' }], terms: [] });
    expect(getMatches.mock.calls[1][1].segmentId).toBe('d');

    d.resolve([{ id: 'tm-d' }] as TMMatch[]);
    await vi.waitFor(() => {
      expect(setResult).toHaveBeenLastCalledWith({ matches: [{ id: 'tm-d' }], terms: [] });
    });
  });
});
