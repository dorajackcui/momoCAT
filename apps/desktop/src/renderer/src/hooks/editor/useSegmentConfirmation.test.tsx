// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { apiClient } from '../../services/apiClient';
import { useSegmentConfirmation } from './useSegmentConfirmation';

vi.mock('../../services/apiClient', () => ({
  apiClient: { updateSegment: vi.fn(), checkSegmentQA: vi.fn() },
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function setup(onConfirmed = vi.fn()) {
  let segments: Segment[] = ['a', 'b'].map((segmentId, orderIndex) => ({
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
  const setActiveSegmentId = vi.fn();
  const setSegmentSaveError = vi.fn();
  const hook = renderHook(() =>
    useSegmentConfirmation({
      segments,
      setSegments: (update) => {
        segments = typeof update === 'function' ? update(segments) : update;
      },
      setActiveSegmentId,
      setSegmentSaveError,
      clearSegmentSaveError: vi.fn(),
      onConfirmed,
    }),
  );
  return {
    ...hook,
    getSegments: () => segments,
    setActiveSegmentId,
    setSegmentSaveError,
    onConfirmed,
  };
}

it('confirms rows with QA findings and navigates without waiting for follow-up work', async () => {
  vi.mocked(apiClient.updateSegment).mockResolvedValue({
    fileId: 1,
    propagatedIds: [],
    serverAppliedAt: 'now',
  });
  const hook = setup(vi.fn(() => new Promise<void>(() => {})));
  await act(async () => hook.result.current.confirmSegment('a'));
  expect(hook.getSegments()[0].status).toBe('confirmed');
  expect(hook.setActiveSegmentId).toHaveBeenCalledWith('b');
  expect(hook.onConfirmed).toHaveBeenCalledOnce();
  expect(apiClient.checkSegmentQA).not.toHaveBeenCalled();
  expect(hook.setSegmentSaveError).not.toHaveBeenCalled();
});

it('keeps write failures separate and does not start a successful-confirm follow-up', async () => {
  vi.mocked(apiClient.updateSegment).mockRejectedValue(new Error('Disk unavailable'));
  const hook = setup();
  await act(async () => hook.result.current.confirmSegment('a'));
  expect(hook.getSegments()[0].status).toBe('draft');
  expect(hook.onConfirmed).not.toHaveBeenCalled();
  expect(hook.setActiveSegmentId).not.toHaveBeenCalled();
  expect(hook.setSegmentSaveError).toHaveBeenCalledWith(
    'a',
    expect.stringContaining('Disk unavailable'),
  );
});
