import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';

vi.mock('../services/apiClient', () => ({
  apiClient: {},
}));

import { useEditor } from './useEditor';
import { createSegmentPersistor } from './editor/useSegmentPersistence';
import { createEditorSegmentStore } from './editor/editorSegmentStore';
import { applyAISegmentTranslateResultToStore } from './editor/useSegmentAI';

function createSegment(segmentId: string, targetText: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Hello' }],
    targetTokens: targetText ? [{ type: 'text', content: targetText }] : [],
    status: targetText ? 'draft' : 'empty',
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

  it('flushes edits arriving during an awaited save before an explicit action proceeds', async () => {
    let finish!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const updateSegment = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValue(undefined);
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
    });
    const edit = (text: string) =>
      persistor.queueSegmentUpdate({
        segmentId: 'a',
        targetTokens: [{ type: 'text', content: text }],
        status: 'draft',
      });
    edit('first');
    const flush = persistor.flushAll();
    await Promise.resolve();
    edit('latest');
    finish();
    await flush;
    expect(updateSegment.mock.calls.map((call) => call[1][0].content)).toEqual(['first', 'latest']);
    expect(persistor.shouldDelayRemoteUpdate('a')).toBe(false);
  });

  it('rejects very old owned echoes after many saves and file-scope resets', async () => {
    const persistor = createSegmentPersistor({
      updateSegment: vi.fn().mockResolvedValue(undefined),
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
    });
    const operation = persistor.beginOperation('a');
    const independent = persistor.beginOperation('b');
    expect(independent.clientRequestId).not.toBe(operation.clientRequestId);
    expect(operation.isCurrent()).toBe(true);
    for (let index = 0; index < 40; index++) {
      persistor.queueSegmentUpdate({
        segmentId: 'a',
        targetTokens: [{ type: 'text', content: String(index) }],
        status: 'draft',
      });
      await persistor.flushAll();
    }
    expect(persistor.isRemoteUpdateStale('a', operation.clientRequestId)).toBe(true);
    persistor.clear();
    expect(persistor.isRemoteUpdateStale('a', operation.clientRequestId)).toBe(true);
    expect(persistor.isRemoteUpdateStale('a', 'another-editor-request')).toBe(false);
    expect(operation.isCurrent()).toBe(false);
  });

  it('serializes newer drafts after confirmation and invalidates its result immediately on input', async () => {
    vi.useFakeTimers();
    const updateSegment = vi.fn().mockResolvedValue(undefined);
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
    });
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let operation!: ReturnType<typeof persistor.beginOperation>;
    const confirming = persistor.runCommit('a', async (op) => {
      operation = op;
      await response;
    });
    await Promise.resolve();
    expect(operation.isCurrent()).toBe(true);
    persistor.queueSegmentUpdate({
      segmentId: 'a',
      targetTokens: [{ type: 'text', content: 'new draft' }],
      status: 'draft',
    });
    expect(operation.isCurrent()).toBe(false);
    expect(persistor.isRemoteUpdateStale('a', operation.clientRequestId)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateSegment).not.toHaveBeenCalled();
    const flush = persistor.flushAll();
    finish();
    await Promise.all([confirming, flush]);
    expect(updateSegment).toHaveBeenCalledOnce();
    expect(updateSegment.mock.calls[0][1]).toEqual([{ type: 'text', content: 'new draft' }]);
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
    await Promise.resolve();
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
    expect(updateSegment).toHaveBeenCalledWith(
      'seg-fail',
      expect.anything(),
      'draft',
      expect.any(String),
    );
    expect(updateSegment).toHaveBeenCalledWith(
      'seg-ok',
      expect.anything(),
      'draft',
      expect.any(String),
    );
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

  it.each(['flushSegment', 'flushAll'] as const)(
    '%s rejects when a save already started by debounce fails',
    async (flushMethod) => {
      vi.useFakeTimers();
      let rejectUpdate!: (error: Error) => void;
      const updateSegment = vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectUpdate = reject;
          }),
      );
      const persistor = createSegmentPersistor({
        updateSegment,
        setSegmentSaveError: vi.fn(),
        clearSegmentSaveError: vi.fn(),
        debounceMs: 100,
      });
      persistor.queueSegmentUpdate({
        segmentId: 'seg-in-flight-error',
        targetTokens: [{ type: 'text', content: 'unsaved draft' }],
        status: 'draft',
      });
      await vi.advanceTimersByTimeAsync(100);

      const flushed = persistor[flushMethod]('seg-in-flight-error');
      const assertion = expect(flushed).rejects.toThrow();
      rejectUpdate(new Error('database busy'));
      await assertion;
      expect(persistor.shouldDelayRemoteUpdate('seg-in-flight-error')).toBe(true);
    },
  );

  it('retries a failed debounced draft when the next action flushes pending edits', async () => {
    vi.useFakeTimers();
    const updateSegment = vi
      .fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValue(undefined);
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
      debounceMs: 100,
    });
    const draft = {
      segmentId: 'seg-retry',
      targetTokens: [{ type: 'text' as const, content: 'keep this draft' }],
      status: 'draft' as const,
    };
    persistor.queueSegmentUpdate(draft);
    await vi.advanceTimersByTimeAsync(100);
    await persistor.flushAll();

    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(updateSegment).toHaveBeenLastCalledWith(
      draft.segmentId,
      draft.targetTokens,
      draft.status,
      expect.any(String),
    );
    expect(persistor.shouldDelayRemoteUpdate(draft.segmentId)).toBe(false);
  });

  it('keeps a newer queued draft when an older in-flight save fails', async () => {
    let rejectUpdate!: (error: Error) => void;
    const updateSegment = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectUpdate = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
    });
    persistor.queueSegmentUpdate({
      segmentId: 'seg-newer',
      targetTokens: [{ type: 'text', content: 'old' }],
      status: 'draft',
    });
    const saving = persistor.flushSegment('seg-newer');
    const assertion = expect(saving).rejects.toThrow('database busy');
    await Promise.resolve();
    persistor.queueSegmentUpdate({
      segmentId: 'seg-newer',
      targetTokens: [{ type: 'text', content: 'newest' }],
      status: 'draft',
    });
    rejectUpdate(new Error('database busy'));
    await assertion;
    await persistor.flushAll();

    expect(updateSegment).toHaveBeenLastCalledWith(
      'seg-newer',
      [{ type: 'text', content: 'newest' }],
      'draft',
      expect.any(String),
    );
  });

  it('does not restore a failed draft after its editor queue has been cleared', async () => {
    let rejectUpdate!: (error: Error) => void;
    const updateSegment = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectUpdate = reject;
        }),
    );
    const setSegmentSaveError = vi.fn();
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError,
      clearSegmentSaveError: vi.fn(),
    });
    persistor.queueSegmentUpdate({
      segmentId: 'seg-cleared',
      targetTokens: [{ type: 'text', content: 'old file draft' }],
      status: 'draft',
    });
    const saving = persistor.flushSegment('seg-cleared');
    const assertion = expect(saving).rejects.toThrow('database busy');
    await Promise.resolve();
    persistor.clear();
    rejectUpdate(new Error('database busy'));
    await assertion;
    await persistor.flushAll();

    expect(updateSegment).toHaveBeenCalledOnce();
    expect(setSegmentSaveError).not.toHaveBeenCalled();
    expect(persistor.shouldDelayRemoteUpdate('seg-cleared')).toBe(false);
  });

  it('keeps a synchronously rejected adapter save retryable', async () => {
    const updateSegment = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('bridge unavailable');
      })
      .mockResolvedValue(undefined);
    const persistor = createSegmentPersistor({
      updateSegment,
      setSegmentSaveError: vi.fn(),
      clearSegmentSaveError: vi.fn(),
    });
    persistor.queueSegmentUpdate({
      segmentId: 'seg-sync-error',
      targetTokens: [{ type: 'text', content: 'draft' }],
      status: 'draft',
    });

    await expect(persistor.flushSegment('seg-sync-error')).rejects.toThrow('bridge unavailable');
    await persistor.flushSegment('seg-sync-error');

    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(persistor.shouldDelayRemoteUpdate('seg-sync-error')).toBe(false);
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

  it('applies AI results to the store without replacing the ordered segment array', () => {
    const first = createSegment('seg-store-ai', '');
    const propagated = createSegment('seg-store-propagated', '');
    const untouched = createSegment('seg-store-untouched', 'keep');
    const store = createEditorSegmentStore([first, propagated, untouched]);
    const ordered = store.getSegments();

    const changes = applyAISegmentTranslateResultToStore(store, {
      fileId: 1,
      segmentId: first.segmentId,
      targetTokens: [{ type: 'text', content: 'AI target' }],
      status: 'draft',
      propagatedIds: [propagated.segmentId],
      serverAppliedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(store.getSegments()).toBe(ordered);
    expect(changes.map((change) => change.segmentId)).toEqual([
      first.segmentId,
      propagated.segmentId,
    ]);
    expect(store.getSegment(first.segmentId)).toMatchObject({ status: 'draft' });
    expect(store.getSegment(propagated.segmentId)).toMatchObject({ status: 'draft' });
    expect(store.getSegment(untouched.segmentId)).toBe(untouched);
  });

  it('keeps helper segment builder valid', () => {
    const segment = createSegment('seg-helper', 'value');
    expect(segment.segmentId).toBe('seg-helper');
  });
});
