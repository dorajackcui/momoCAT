import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';

vi.mock('../services/apiClient', () => ({
  apiClient: {},
}));

import { createSegmentPersistor, useEditor } from './useEditor';

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

  it('reports remote-update delay state for pending/in-flight segments only', async () => {
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
    expect(persistor.shouldDelayRemoteUpdate('seg-4')).toBe(false);
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
    await persistor.flushSegment('seg-5');

    expect(setSegmentSaveError).toHaveBeenCalledWith(
      'seg-5',
      expect.stringContaining('network down'),
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

  it('keeps helper segment builder valid', () => {
    const segment = createSegment('seg-helper', 'value');
    expect(segment.segmentId).toBe('seg-helper');
  });
});
