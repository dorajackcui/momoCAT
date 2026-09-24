// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { parseDisplayTextToTokens } from '@cat/core/tag';
import { useSelectedSegmentActions } from './useSelectedSegmentActions';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';

vi.mock('../../services/apiClient', () => ({
  apiClient: { updateSelectedSegments: vi.fn(), checkSegmentQA: vi.fn() },
}));
vi.mock('../../services/feedbackService', () => ({
  feedbackService: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.updateSelectedSegments).mockImplementation(async (fileId, updates) =>
    updates.map((update) => ({ ...update, fileId, propagatedIds: [], serverAppliedAt: 'now' })),
  );
});

function setup() {
  const segments: Segment[] = ['a', 'b', 'c'].map((id, orderIndex) => ({
    segmentId: id,
    fileId: 1,
    orderIndex,
    srcHash: id,
    matchKey: id,
    tagsSignature: '',
    sourceTokens: parseDisplayTextToTokens('Hello <b>world</b>'),
    targetTokens: parseDisplayTextToTokens('Old <b>target</b>'),
    status: 'draft',
  }));
  const flush = vi.fn().mockResolvedValue(undefined);
  const applyUpdates = vi.fn();
  const clearSaveError = vi.fn();
  const hook = renderHook(
    ({ fileId, tagPolicy }: { fileId: number; tagPolicy: 'default' | 'none' }) =>
      useSelectedSegmentActions({
        fileId,
        getSegment: (id) => segments.find((s) => s.segmentId === id),
        flushPending: flush,
        applyUpdates,
        clearSaveError,
        tagPolicy,
        onConfirmed: vi.fn(),
      }),
    { initialProps: { fileId: 1, tagPolicy: 'default' } },
  );
  return { ...hook, flush, applyUpdates, clearSaveError, getSegments: () => segments };
}

describe('selected segment actions', () => {
  it('flushes drafts before copying sources, preserving tags and the snapshotted IDs', async () => {
    const hook = setup();
    let finish!: () => void;
    hook.flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ids = ['a', 'c'];
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.runSelectedSegmentAction('copy-source', ids);
    });
    ids.push('b');
    expect(apiClient.updateSelectedSegments).not.toHaveBeenCalled();
    expect(hook.result.current.isSelectedSegmentActionRunning).toBe(true);
    await act(async () => {
      finish();
      await pending;
    });
    const updates = vi.mocked(apiClient.updateSelectedSegments).mock.calls[0][1];
    expect(updates.map((u) => u.segmentId)).toEqual(['a', 'c']);
    expect(updates[0].targetTokens).toEqual(hook.getSegments()[0].sourceTokens);
    expect(updates.every((u) => u.status === 'draft')).toBe(true);
    expect(hook.applyUpdates).toHaveBeenCalledOnce();
  });

  it('clears selected confirmed targets to empty', async () => {
    const hook = setup();
    hook.getSegments()[0].status = 'confirmed';
    await act(async () => hook.result.current.runSelectedSegmentAction('clear', ['a']));
    expect(apiClient.updateSelectedSegments).toHaveBeenCalledWith(1, [
      { segmentId: 'a', targetTokens: [], status: 'empty' },
    ]);
  });

  it('copies literal tag-like text under the none tag policy', async () => {
    const hook = setup();
    hook.getSegments()[0].sourceTokens = [{ type: 'text', content: 'Hello <b>{1}</b>' }];
    hook.rerender({ fileId: 1, tagPolicy: 'none' });
    await act(async () => hook.result.current.runSelectedSegmentAction('copy-source', ['a']));
    expect(vi.mocked(apiClient.updateSelectedSegments).mock.calls[0][1][0].targetTokens).toEqual(
      hook.getSegments()[0].sourceTokens,
    );
  });

  it('confirms every selected row without requesting QA', async () => {
    const hook = setup();
    hook.getSegments()[1].targetTokens = [{ type: 'text', content: 'Missing tags' }];
    hook.getSegments()[1].qaIssues = [
      { ruleId: 'tag-missing', severity: 'error', message: 'Missing' },
    ];
    await act(async () => hook.result.current.runSelectedSegmentAction('confirm', ['a', 'b']));
    expect(
      vi.mocked(apiClient.updateSelectedSegments).mock.calls[0][1].map((u) => u.segmentId),
    ).toEqual(['a', 'b']);
    expect(apiClient.checkSegmentQA).not.toHaveBeenCalled();
    expect(feedbackService.success).toHaveBeenCalledWith('Confirmed 2 segments.');
  });

  it('aborts when saving drafts fails and leaves targets intact when batch persistence fails', async () => {
    const hook = setup();
    hook.flush.mockRejectedValueOnce(new Error('draft save failed'));
    await act(async () => hook.result.current.runSelectedSegmentAction('clear', ['a']));
    expect(apiClient.updateSelectedSegments).not.toHaveBeenCalled();
    vi.mocked(apiClient.updateSelectedSegments).mockRejectedValueOnce(new Error('write failed'));
    await act(async () => hook.result.current.runSelectedSegmentAction('clear', ['a']));
    expect(hook.applyUpdates).not.toHaveBeenCalled();
    expect(hook.getSegments()[0].targetTokens).not.toEqual([]);
    expect(hook.result.current.isSelectedSegmentActionRunning).toBe(false);
  });

  it('blocks double submission and ignores a delayed result after switching files', async () => {
    const hook = setup();
    let finish!: (events: []) => void;
    vi.mocked(apiClient.updateSelectedSegments).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = hook.result.current.runSelectedSegmentAction('clear', ['a']);
    });
    await act(async () => hook.result.current.runSelectedSegmentAction('clear', ['b']));
    expect(apiClient.updateSelectedSegments).toHaveBeenCalledOnce();
    hook.rerender({ fileId: 2, tagPolicy: 'default' });
    await act(async () => {
      finish([]);
      await pending;
    });
    expect(hook.applyUpdates).not.toHaveBeenCalled();
    expect(feedbackService.success).not.toHaveBeenCalled();
  });
});
