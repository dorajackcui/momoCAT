import { useCallback, useRef } from 'react';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import type { EditorSegmentStore } from './editorSegmentStore';
import type { SegmentOperation } from './useSegmentPersistence';

interface Params {
  store: EditorSegmentStore;
  flushPending: () => Promise<void>;
  runCommit: <T>(id: string, task: (operation: SegmentOperation) => Promise<T>) => Promise<T>;
  setSegmentSaveError: (id: string, message: string) => void;
  clearSegmentSaveError: (id: string) => void;
  onConfirmed: (event: SegmentsUpdatedEvent, accept: (id?: string) => boolean) => void;
}

export function useSegmentConfirmation({
  store,
  flushPending,
  runCommit,
  setSegmentSaveError,
  clearSegmentSaveError,
  onConfirmed,
}: Params) {
  const running = useRef(new Set<string>());
  const confirmSegment = useCallback(
    async (id: string): Promise<boolean> => {
      if (running.current.has(id)) return false;
      running.current.add(id);
      const order = store.getOrderIds();
      try {
        // Confirmation may propagate to repeats, so finish all earlier local drafts first.
        await flushPending();
        if (store.getOrderIds() !== order) return false;
        const segment = store.getSegment(id);
        if (!segment) return false;
        return await runCommit(id, async (operation) => {
          store.updateSegment(id, (current) => ({ ...current, status: 'confirmed' }));
          clearSegmentSaveError(id);
          try {
            const result = await apiClient.updateSegment(
              id,
              segment.targetTokens,
              'confirmed',
              operation.clientRequestId,
            );
            onConfirmed(
              { ...result, segmentId: id, targetTokens: segment.targetTokens, status: 'confirmed' },
              operation.isCurrent,
            );
            return operation.isCurrent();
          } catch (error) {
            if (operation.isCurrent()) {
              store.updateSegment(id, (current) => ({ ...current, status: segment.status }));
              setSegmentSaveError(
                id,
                `保存失败：${error instanceof Error ? error.message : String(error)}`,
              );
            }
            return false;
          }
        });
      } catch {
        // The draft persistor owns visible flush failures and keeps the draft retryable.
        return false;
      } finally {
        running.current.delete(id);
      }
    },
    [store, flushPending, runCommit, clearSegmentSaveError, setSegmentSaveError, onConfirmed],
  );
  return { confirmSegment };
}
