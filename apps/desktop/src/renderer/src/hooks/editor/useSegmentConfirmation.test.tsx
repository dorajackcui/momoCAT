// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { apiClient } from '../../services/apiClient';
import { createEditorSegmentStore } from './editorSegmentStore';
import { createSegmentPersistor } from './useSegmentPersistence';
import { useSegmentConfirmation } from './useSegmentConfirmation';

vi.mock('../../services/apiClient', () => ({
  apiClient: { updateSegment: vi.fn(), checkSegmentQA: vi.fn() },
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function setup(onConfirmed = vi.fn()) {
  const segments: Segment[] = ['a', 'b'].map((segmentId, orderIndex) => ({
    segmentId,
    fileId: 1,
    orderIndex,
    status: 'draft',
    sourceTokens: [{ type: 'tag', content: '{name}' }],
    targetTokens: [],
    tagsSignature: '',
    matchKey: '',
    srcHash: '',
    qaIssues: [{ ruleId: 'tag-missing', severity: 'error', message: 'Missing marker' }],
  }));
  const setSegmentSaveError = vi.fn();
  const store = createEditorSegmentStore(segments);
  const persistor = createSegmentPersistor({
    updateSegment: vi.fn(),
    setSegmentSaveError,
    clearSegmentSaveError: vi.fn(),
  });
  const hook = renderHook(() =>
    useSegmentConfirmation({
      store,
      flushPending: persistor.flushAll,
      runCommit: persistor.runCommit,
      setSegmentSaveError,
      clearSegmentSaveError: vi.fn(),
      onConfirmed,
    }),
  );
  return {
    ...hook,
    getSegments: store.getSegments,
    setSegmentSaveError,
    onConfirmed,
  };
}

it('confirms rows with QA findings and reports success without waiting for follow-up work', async () => {
  vi.mocked(apiClient.updateSegment).mockResolvedValue({
    fileId: 1,
    propagatedIds: [],
    serverAppliedAt: 'now',
  });
  const hook = setup(vi.fn(() => new Promise<void>(() => {})));
  await act(async () => expect(hook.result.current.confirmSegment('a')).resolves.toBe(true));
  expect(hook.getSegments()[0].status).toBe('confirmed');
  expect(hook.onConfirmed).toHaveBeenCalledOnce();
  expect(apiClient.checkSegmentQA).not.toHaveBeenCalled();
  expect(hook.setSegmentSaveError).not.toHaveBeenCalled();
});

it('keeps write failures separate and does not start a successful-confirm follow-up', async () => {
  vi.mocked(apiClient.updateSegment).mockRejectedValue(new Error('Disk unavailable'));
  const hook = setup();
  await act(async () => expect(hook.result.current.confirmSegment('a')).resolves.toBe(false));
  expect(hook.getSegments()[0].status).toBe('draft');
  expect(hook.onConfirmed).not.toHaveBeenCalled();
  expect(hook.setSegmentSaveError).toHaveBeenCalledWith(
    'a',
    expect.stringContaining('Disk unavailable'),
  );
});
