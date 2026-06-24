import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';

vi.mock('../services/apiClient', () => ({
  apiClient: {},
}));

import {
  applyAISegmentTranslateResultToSegments,
  createSegmentPersistor,
  useEditor,
} from './useEditor';
import {
  buildOptimisticSegmentUpdate,
  resolveSegmentStateUpdate,
} from './editor/useSegmentPersistence';

function createSegment(segmentId: string, targetText: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Hello' }],
    targetTokens: targetText ? [{ type: 'text', content: targetText }] : [],
    status: targetText ? 'draft' : 'new',
    tagsSignature: '',
    matchKey: 'hello',
    srcHash: `hash-${segmentId}`,
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

describe('createSegmentPersistor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces consecutive updates and persists only the latest payload', async () => {
    vi.useFakeTimers();
    const updateSegment = vi.fn().mockResolvedValue(undefined);
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
      debounceMs: 350,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-1',
      targetTokens: [{ type: 'text', content: 'old' }],
      status: 'draft',
    });
    persistor.queueSegmentUpdate({
      segmentId: 'seg-1',
      targetTokens: [{ type: 'text', content: 'new' }],
      status: 'draft',
    });

    await vi.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledWith(
      'seg-1',
      [{ type: 'text', content: 'new' }],
      'draft',
      expect.any(String),
    );
    expect(setSegmentSaveError).not.toHaveBeenCalled();
  });

  it('flushes pending segment updates immediately', async () => {
    vi.useFakeTimers();
    const updateSegment = vi.fn().mockResolvedValue(undefined);
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-2',
      targetTokens: [{ type: 'text', content: 'flush-now' }],
      status: 'draft',
    });

    await persistor.flushSegment('seg-2');

    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledWith(
      'seg-2',
      [{ type: 'text', content: 'flush-now' }],
      'draft',
      expect.any(String),
    );
  });

  it('marks stale remote events by client request id', async () => {
    const capturedRequestIds: string[] = [];
    const updateSegment = vi
      .fn()
      .mockImplementation(
        async (
          _segmentId: string,
          _targetTokens: Token[],
          _status: string,
          clientRequestId?: string,
        ) => {
          if (clientRequestId) {
            capturedRequestIds.push(clientRequestId);
          }
        },
      );
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
      debounceMs: 0,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-3',
      targetTokens: [{ type: 'text', content: 'v1' }],
      status: 'draft',
    });
    await persistor.flushSegment('seg-3');
    persistor.queueSegmentUpdate({
      segmentId: 'seg-3',
      targetTokens: [{ type: 'text', content: 'v2' }],
      status: 'draft',
    });
    await persistor.flushSegment('seg-3');

    expect(capturedRequestIds).toHaveLength(2);
    expect(persistor.isRemoteUpdateStale('seg-3', capturedRequestIds[0])).toBe(true);
    expect(persistor.isRemoteUpdateStale('seg-3', capturedRequestIds[1])).toBe(false);
  });

  it('reports remote-update delay state for actively edited, pending, and in-flight segments', async () => {
    let resolveUpdate: (() => void) | undefined;
    const updateSegment = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
      debounceMs: 0,
    });

    persistor.setSegmentEditing('seg-4', true);
    expect(persistor.shouldDelayRemoteUpdate('seg-4')).toBe(true);
    persistor.setSegmentEditing('seg-4', false);

    persistor.queueSegmentUpdate({
      segmentId: 'seg-4',
      targetTokens: [{ type: 'text', content: 'queued' }],
      status: 'draft',
    });
    expect(persistor.shouldDelayRemoteUpdate('seg-4')).toBe(true);

    const flushPromise = persistor.flushSegment('seg-4');
    expect(persistor.shouldDelayRemoteUpdate('seg-4')).toBe(true);
    resolveUpdate?.();
    await flushPromise;
    expect(persistor.shouldDelayRemoteUpdate('seg-4')).toBe(false);
  });

  it('records save errors for latest failed request without rollback', async () => {
    const updateSegment = vi.fn().mockRejectedValue(new Error('network down'));
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
      debounceMs: 0,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-5',
      targetTokens: [{ type: 'text', content: 'text' }],
      status: 'draft',
    });
    await expect(persistor.flushSegment('seg-5')).rejects.toThrow('network down');

    expect(setSegmentSaveError).toHaveBeenCalledWith(
      'seg-5',
      expect.stringContaining('network down'),
    );
  });

  it('flushSegment rejects when updateSegment fails', async () => {
    const updateSegment = vi.fn().mockRejectedValue(new Error('network down'));
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
      debounceMs: 0,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-flush-err',
      targetTokens: [{ type: 'text', content: 'text' }],
      status: 'draft',
    });

    await expect(persistor.flushSegment('seg-flush-err')).rejects.toThrow('network down');
    expect(setSegmentSaveError).toHaveBeenCalledWith(
      'seg-flush-err',
      expect.stringContaining('network down'),
    );
  });

  it('flushAll rejects when any segment update fails and still attempts all segments', async () => {
    const updateSegment = vi.fn().mockImplementation((segmentId: string) => {
      if (segmentId === 'seg-fail') return Promise.reject(new Error('save failed'));
      return Promise.resolve();
    });
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
      debounceMs: 0,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-fail',
      targetTokens: [{ type: 'text', content: 'fail' }],
      status: 'draft',
    });
    persistor.queueSegmentUpdate({
      segmentId: 'seg-ok',
      targetTokens: [{ type: 'text', content: 'ok' }],
      status: 'draft',
    });

    await expect(persistor.flushAll()).rejects.toThrow();
    expect(updateSegment).toHaveBeenCalledWith('seg-fail', expect.anything(), 'draft', expect.any(String));
    expect(updateSegment).toHaveBeenCalledWith('seg-ok', expect.anything(), 'draft', expect.any(String));
  });

  it('debounce-triggered persist records error without unhandled rejection', async () => {
    vi.useFakeTimers();
    const updateSegment = vi.fn().mockRejectedValue(new Error('timeout'));
    const setSegmentSaveError = vi.fn();
    const clearSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError,
      debounceMs: 100,
    });

    persistor.queueSegmentUpdate({
      segmentId: 'seg-debounce-err',
      targetTokens: [{ type: 'text', content: 'text' }],
      status: 'draft',
    });

    await vi.advanceTimersByTimeAsync(150);

    expect(setSegmentSaveError).toHaveBeenCalledWith(
      'seg-debounce-err',
      expect.stringContaining('timeout'),
    );
  });

  it('exposes editor persistence controls in useEditor return type', () => {
    type UseEditorResult = ReturnType<typeof useEditor>;
    const acceptsFlush = (flush: UseEditorResult['flushSegmentDraft']) => flush;
    const flush = acceptsFlush(async () => undefined);
    expect(typeof flush).toBe('function');
    const acceptsEditState = (fn: UseEditorResult['handleSegmentEditStateChange']) => fn;
    const editState = acceptsEditState(() => undefined);
    expect(typeof editState).toBe('function');
    const acceptsReload = (reload: UseEditorResult['reloadEditorData']) => reload;
    const reload = acceptsReload(async () => undefined);
    expect(typeof reload).toBe('function');
  });

  it('applies AI segment translate result to the current segment list immediately', () => {
    const unchangedConfirmed = createSegment('seg-confirmed', 'keep qa');
    unchangedConfirmed.status = 'confirmed';
    unchangedConfirmed.qaIssues = [
      { severity: 'warning', message: 'existing', ruleId: 'terminology' },
    ];

    const segments = [createSegment('seg-6', ''), createSegment('seg-7', ''), unchangedConfirmed];

    const result = applyAISegmentTranslateResultToSegments(segments, {
      segmentId: 'seg-6',
      targetTokens: [{ type: 'text', content: 'AI target' }],
      status: 'translated',
      propagatedIds: ['seg-7'],
      serverAppliedAt: '2026-06-12T00:00:00.000Z',
    });

    expect(result).not.toBe(segments);
    expect(result.find((segment) => segment.segmentId === 'seg-6')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'AI target' }],
      status: 'translated',
      qaIssues: undefined,
      autoFixSuggestions: undefined,
    });
    expect(result.find((segment) => segment.segmentId === 'seg-7')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'AI target' }],
      status: 'draft',
      qaIssues: undefined,
      autoFixSuggestions: undefined,
    });
    expect(result.find((segment) => segment.segmentId === 'seg-confirmed')).toBe(
      unchangedConfirmed,
    );
  });

  it('keeps helper segment builder valid', () => {
    const segment = createSegment('seg-helper', 'value');
    expect(segment.segmentId).toBe('seg-helper');
  });
});

describe('buildOptimisticSegmentUpdate', () => {
  it('returns updated segments and a save payload synchronously', () => {
    const original = createSegment('seg-optimistic', '');

    const result = buildOptimisticSegmentUpdate([original], 'seg-optimistic', (segment) => ({
      ...segment,
      targetTokens: [{ type: 'text', content: 'Matched target' }],
      status: 'draft',
    }));

    expect(result.updatedSegment).toMatchObject({
      segmentId: 'seg-optimistic',
      targetTokens: [{ type: 'text', content: 'Matched target' }],
      status: 'draft',
    });
    expect(result.segments[0]).toBe(result.updatedSegment);
  });

  it('leaves state unchanged when the segment is missing', () => {
    const original = [createSegment('seg-existing', '')];

    const result = buildOptimisticSegmentUpdate(original, 'seg-missing', (segment) => ({
      ...segment,
      targetTokens: [{ type: 'text', content: 'Should not apply' }],
    }));

    expect(result.segments).toBe(original);
    expect(result.updatedSegment).toBeUndefined();
  });
});

describe('resolveSegmentStateUpdate', () => {
  it('composes queued functional updates before building the next optimistic edit', () => {
    const first = createSegment('seg-first', '');
    const aiTarget = createSegment('seg-ai', '');
    const current = [first, aiTarget];

    const afterAI = resolveSegmentStateUpdate(current, (prev) =>
      applyAISegmentTranslateResultToSegments(prev, {
        segmentId: 'seg-ai',
        targetTokens: [{ type: 'text', content: 'AI target' }],
        status: 'translated',
        propagatedIds: [],
        serverAppliedAt: '2026-06-24T00:00:00.000Z',
      }),
    );
    const afterEdit = buildOptimisticSegmentUpdate(afterAI, 'seg-first', (segment) => ({
      ...segment,
      targetTokens: [{ type: 'text', content: 'Manual edit' }],
      status: 'draft',
    }));

    expect(afterEdit.segments.find((segment) => segment.segmentId === 'seg-first')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'Manual edit' }],
      status: 'draft',
    });
    expect(afterEdit.segments.find((segment) => segment.segmentId === 'seg-ai')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'AI target' }],
      status: 'translated',
    });
  });
});
