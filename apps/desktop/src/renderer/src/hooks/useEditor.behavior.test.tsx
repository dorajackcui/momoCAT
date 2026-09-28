// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
vi.mock('../services/apiClient', () => ({
  apiClient: {
    getFile: vi.fn(),
    getSegments: vi.fn(),
    updateSegment: vi.fn(),
    checkSegmentQA: vi.fn(),
    aiTranslateSegment: vi.fn(),
    aiRefineSegment: vi.fn(),
    onSegmentsUpdatedBatch: vi.fn(() => () => {}),
    onSegmentsUpdated: vi.fn(() => () => {}),
    onReferenceDataChanged: vi.fn(() => () => {}),
    onQAInvalidated: vi.fn(() => () => {}),
  },
}));
import { apiClient } from '../services/apiClient';
import { useEditor } from './useEditor';
function row(id: string): Segment {
  return {
    segmentId: id,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'source ' + id }],
    targetTokens: [{ type: 'text', content: 'old' }],
    status: 'draft',
    srcHash: id,
    matchKey: id,
    tagsSignature: '',
    meta: {},
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(apiClient.getFile).mockResolvedValue({ id: 1, projectId: 1 } as never);
  vi.mocked(apiClient.getSegments).mockResolvedValue([row('a'), row('b'), row('c')]);
  vi.mocked(apiClient.checkSegmentQA).mockResolvedValue(null);
  vi.mocked(apiClient.updateSegment).mockImplementation(async () => ({
    fileId: 1,
    propagatedIds: [],
    serverAppliedAt: 'now',
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function setup() {
  const hook = renderHook(({ fileId }) => useEditor({ activeFileId: fileId }), {
    initialProps: { fileId: 1 },
  });
  await waitFor(() => expect(hook.result.current.segments).toHaveLength(3));
  return hook;
}

it('keeps a newer draft through confirmation, its broadcast echo and the following save', async () => {
  const h = await setup(),
    response = deferred<Awaited<ReturnType<typeof apiClient.updateSegment>>>();
  vi.mocked(apiClient.updateSegment).mockReturnValueOnce(response.promise);
  let confirming!: Promise<boolean>;
  act(() => {
    confirming = h.result.current.confirmSegment('a');
  });
  await waitFor(() => expect(apiClient.updateSegment).toHaveBeenCalledOnce());
  const requestId = vi.mocked(apiClient.updateSegment).mock.calls[0][3];
  expect(requestId).toEqual(expect.any(String));
  act(() => h.result.current.handleTranslationChange('a', 'newer draft'));
  const broadcast = vi.mocked(apiClient.onSegmentsUpdated).mock.calls.at(-1)![0];
  const echo = {
    fileId: 1,
    segmentId: 'a',
    targetTokens: row('a').targetTokens,
    status: 'confirmed' as const,
    propagatedIds: [],
    serverAppliedAt: 'now',
    clientRequestId: requestId,
  };
  act(() => broadcast(echo));
  await act(async () => {
    response.resolve(echo);
    expect(await confirming).toBe(false);
  });
  expect(h.result.current.segmentStore.getSegment('a')).toMatchObject({
    targetTokens: [{ type: 'text', content: 'newer draft' }],
    status: 'draft',
  });
  await act(async () => h.result.current.flushPendingSegmentUpdates());
  act(() => broadcast(echo));
  expect(h.result.current.segmentStore.getSegment('a')?.targetTokens[0].content).toBe(
    'newer draft',
  );
  expect(vi.mocked(apiClient.updateSegment).mock.calls.at(-1)![1]).toEqual([
    { type: 'text', content: 'newer draft' },
  ]);
});

it('applies confirmation to unchanged repeats while protecting a repeat edited during the request', async () => {
  const h = await setup(),
    response = deferred<Awaited<ReturnType<typeof apiClient.updateSegment>>>();
  vi.mocked(apiClient.updateSegment).mockReturnValueOnce(response.promise);
  let confirming!: Promise<boolean>;
  act(() => {
    confirming = h.result.current.confirmSegment('a');
  });
  await waitFor(() => expect(apiClient.updateSegment).toHaveBeenCalledOnce());
  act(() => h.result.current.handleTranslationChange('b', 'new repeat draft'));
  await act(async () => {
    response.resolve({ fileId: 1, propagatedIds: ['b', 'c'], serverAppliedAt: 'now' });
    expect(await confirming).toBe(true);
  });
  expect(h.result.current.segmentStore.getSegment('b')).toMatchObject({
    status: 'draft',
    targetTokens: [{ type: 'text', content: 'new repeat draft' }],
  });
  expect(h.result.current.segmentStore.getSegment('c')?.status).toBe('confirmed');
});

it.each(['translate', 'refine'] as const)(
  'keeps newer input after delayed AI %s and ignores its owned echo',
  async (kind) => {
    const h = await setup(),
      response = deferred<Awaited<ReturnType<typeof apiClient.aiTranslateSegment>>>();
    const request =
      kind === 'translate'
        ? vi.mocked(apiClient.aiTranslateSegment)
        : vi.mocked(apiClient.aiRefineSegment);
    request.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => {
      pending =
        kind === 'translate'
          ? h.result.current.translateSegmentWithAI('a')
          : h.result.current.refineSegmentWithAI('a', 'make concise');
    });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const args = request.mock.calls[0];
    const requestId = args.at(-1) as string;
    act(() => h.result.current.handleTranslationChange('a', 'newer draft'));
    const result = {
      fileId: 1,
      segmentId: 'a',
      targetTokens: [{ type: 'text' as const, content: 'AI result' }],
      status: 'draft' as const,
      propagatedIds: [],
      serverAppliedAt: 'now',
    };
    await act(async () => {
      response.resolve(result);
      await pending;
    });
    await act(async () => h.result.current.flushPendingSegmentUpdates());
    act(() =>
      vi
        .mocked(apiClient.onSegmentsUpdated)
        .mock.calls.at(-1)![0]({ ...result, clientRequestId: requestId }),
    );
    expect(h.result.current.segmentStore.getSegment('a')?.targetTokens[0].content).toBe(
      'newer draft',
    );
    expect(h.result.current.aiTranslatingSegmentIds).toEqual({});
  },
);

it('does not confirm when a pending draft fails to save', async () => {
  const h = await setup();
  vi.mocked(apiClient.updateSegment).mockRejectedValueOnce(new Error('Disk unavailable'));
  act(() => h.result.current.handleTranslationChange('a', 'unsaved'));
  await act(async () => expect(h.result.current.confirmSegment('a')).resolves.toBe(false));
  expect(apiClient.updateSegment).toHaveBeenCalledOnce();
  expect(h.result.current.segmentStore.getSegment('a')?.status).toBe('draft');
  expect(h.result.current.segmentSaveErrors.a).toContain('Disk unavailable');
});

it('ignores a stale file load after switching to a different file', async () => {
  const first = deferred<Segment[]>();
  vi.mocked(apiClient.getSegments)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([{ ...row('other'), fileId: 2 }]);
  const h = renderHook(({ fileId }) => useEditor({ activeFileId: fileId }), {
    initialProps: { fileId: 1 },
  });
  await waitFor(() => expect(apiClient.getSegments).toHaveBeenCalledOnce());
  h.rerender({ fileId: 2 });
  await waitFor(() => expect(h.result.current.segments[0]?.segmentId).toBe('other'));
  await act(async () => first.resolve([row('old-file')]));
  expect(h.result.current.segments[0]?.segmentId).toBe('other');
  expect(h.result.current.loading).toBe(false);
});

it('keeps a newer AI result on a repeated follower after its leader confirmation responds late', async () => {
  const h = await setup();
  const confirmation = deferred<Awaited<ReturnType<typeof apiClient.updateSegment>>>();
  vi.mocked(apiClient.updateSegment).mockReturnValueOnce(confirmation.promise);
  let confirming!: Promise<boolean>;
  act(() => {
    confirming = h.result.current.confirmSegment('a');
  });
  await waitFor(() => expect(apiClient.updateSegment).toHaveBeenCalledOnce());
  vi.mocked(apiClient.aiTranslateSegment).mockResolvedValueOnce({
    fileId: 1,
    segmentId: 'b',
    targetTokens: [{ type: 'text', content: 'New AI follower' }],
    status: 'draft',
    propagatedIds: [],
    serverAppliedAt: 'now',
  });
  await act(async () => h.result.current.translateSegmentWithAI('b'));
  expect(h.result.current.segmentStore.getSegment('b')?.targetTokens[0].content).toBe(
    'New AI follower',
  );
  await act(async () => {
    confirmation.resolve({ fileId: 1, propagatedIds: ['b'], serverAppliedAt: 'now' });
    await confirming;
  });
  expect(h.result.current.segmentStore.getSegment('b')?.targetTokens[0].content).toBe(
    'New AI follower',
  );
});
