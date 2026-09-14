// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { useEditorBatchActions } from './useEditorBatchActions';
import { useEditorFilters } from '../useEditorFilters';
import { createAIFileJobTracker } from '../aiFileJobs';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';

vi.mock('../../services/apiClient', () => ({ apiClient: { aiTranslateFile: vi.fn() } }));
vi.mock('../../services/feedbackService', () => ({
  feedbackService: { info: vi.fn(), error: vi.fn() },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(apiClient.aiTranslateFile).mockResolvedValue('job-filtered');
});

function setup(initialIds: string[] | null) {
  const tracker = createAIFileJobTracker();
  const getFilteredSegmentIds = vi.fn(() => initialIds);
  const flush = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ fileId }) =>
      useEditorBatchActions({
        fileId,
        fileName: 'names.xlsx',
        supportsBatchActions: true,
        getFilteredSegmentIds,
        flushPendingSegmentUpdates: flush,
        reloadEditorData: vi.fn(),
        aiFileJobTracker: tracker,
      }),
    { initialProps: { fileId: 1 } },
  );
  return { ...hook, tracker, getFilteredSegmentIds, flush };
}

describe('editor filtered AI translation', () => {
  it('snapshots the dialog scope before save/translation changes the matching results', async () => {
    const ids = ['s10', 's30', 's80'];
    const { result, getFilteredSegmentIds, flush, tracker } = setup(ids);
    act(() => result.current.openBatchAIModal());
    ids.pop();
    getFilteredSegmentIds.mockReturnValue(['s90']);
    expect(result.current.batchAIFilteredCount).toBe(3);
    await act(async () =>
      result.current.handleBatchAITranslate({ targetBaseline: 'ignore-current-targets' }),
    );
    expect(flush).toHaveBeenCalledOnce();
    expect(apiClient.aiTranslateFile).toHaveBeenCalledWith(1, {
      targetBaseline: 'ignore-current-targets',
      segmentIds: ['s10', 's30', 's80'],
    });
    expect(tracker.getFileJob(1)?.jobId).toBe('job-filtered');
  });

  it.each([null, ['s10']].map((ids) => ({ ids })))(
    'omits scope for whole-file translation with filters $ids',
    async ({ ids }) => {
      const { result } = setup(ids);
      act(() => result.current.openBatchAIModal());
      await act(async () =>
        result.current.handleBatchAITranslate({
          targetBaseline: 'use-current-targets',
          scope: 'file',
        }),
      );
      expect(apiClient.aiTranslateFile).toHaveBeenCalledWith(1, {
        targetBaseline: 'use-current-targets',
      });
    },
  );

  it('does not start a job for an empty filter or a failed save', async () => {
    const { result, getFilteredSegmentIds, flush } = setup([]);
    act(() => result.current.openBatchAIModal());
    await act(async () =>
      result.current.handleBatchAITranslate({ targetBaseline: 'use-current-targets' }),
    );
    expect(apiClient.aiTranslateFile).not.toHaveBeenCalled();
    expect(result.current.isBatchAIModalOpen).toBe(true);
    getFilteredSegmentIds.mockReturnValue(['s10']);
    act(() => result.current.openBatchAIModal());
    flush.mockRejectedValue(new Error('save failed'));
    await act(async () =>
      result.current.handleBatchAITranslate({ targetBaseline: 'use-current-targets' }),
    );
    expect(apiClient.aiTranslateFile).not.toHaveBeenCalled();
    expect(feedbackService.error).toHaveBeenCalledWith(expect.stringContaining('save failed'));
  });

  it('clears the snapshot when switching files', () => {
    const { result, rerender } = setup(['s10']);
    act(() => result.current.openBatchAIModal());
    rerender({ fileId: 2 });
    expect(result.current.isBatchAIModalOpen).toBe(false);
    expect(result.current.batchAIFilteredCount).toBeUndefined();
  });

  it('captures the latest context search before the display debounce', () => {
    const segments = ['name', 'dialogue', 'name'].map((context, index) => ({
      segmentId: `s${index}`,
      orderIndex: index,
      srcHash: `hash${index}`,
      sourceTokens: [{ type: 'text', content: index === 0 ? 'Long name' : 'A' }],
      targetTokens: [],
      status: 'new',
      meta: { context },
    })) as Segment[];
    const { result } = renderHook(() =>
      useEditorFilters({
        fileId: 1,
        segments,
        segmentSaveErrors: {},
        activeSegmentId: null,
        setActiveSegmentId: vi.fn(),
      }),
    );
    expect(result.current.getFilteredSegmentIds()).toBeNull();
    act(() => {
      result.current.toggleTargetSearchScope();
      result.current.setTargetQueryInput('name');
    });
    expect(result.current.debouncedTargetQuery).toBe('');
    expect(result.current.getFilteredSegmentIds()).toEqual(['s0', 's2']);
  });

  it('uses the retained visible result set when edits change a row status', () => {
    const segment = {
      segmentId: 's10',
      srcHash: 'hash',
      sourceTokens: [{ type: 'text', content: 'Name' }],
      targetTokens: [],
      status: 'new',
    } as Segment;
    const { result, rerender } = renderHook(
      ({ segments }) =>
        useEditorFilters({
          fileId: 1,
          segments,
          segmentSaveErrors: {},
          activeSegmentId: null,
          setActiveSegmentId: vi.fn(),
        }),
      { initialProps: { segments: [segment] } },
    );
    act(() => result.current.handleStatusFilterChange('new'));
    rerender({ segments: [{ ...segment, status: 'translated' }] });
    expect(result.current.filteredSegments).toHaveLength(1);
    expect(result.current.getFilteredSegmentIds()).toEqual(['s10']);
  });
});
