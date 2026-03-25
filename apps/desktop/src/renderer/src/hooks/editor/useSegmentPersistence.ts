import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { apiClient } from '../../services/apiClient';

const DEFAULT_PERSIST_DEBOUNCE_MS = 350;

interface QueueSegmentUpdateInput {
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
}

interface SegmentPersistorDeps {
  updateSegment: (
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    clientRequestId?: string,
  ) => Promise<unknown>;
  setSegmentSaveError: (segmentId: string, message: string) => void;
  clearSegmentSaveError: (segmentId: string) => void;
  onStateChange?: () => void;
  debounceMs?: number;
}

interface SegmentPersistor {
  queueSegmentUpdate: (input: QueueSegmentUpdateInput) => void;
  flushSegment: (segmentId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  setSegmentEditing: (segmentId: string, editing: boolean) => void;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  clear: () => void;
}

export function createSegmentPersistor(deps: SegmentPersistorDeps): SegmentPersistor {
  const persistDebounceMs = deps.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
  const pendingBySegment = new Map<string, QueueSegmentUpdateInput>();
  const debounceTimerBySegment = new Map<string, ReturnType<typeof setTimeout>>();
  const latestRequestSeqBySegment = new Map<string, number>();
  const requestSeqByRequestIdBySegment = new Map<string, Map<string, number>>();
  const inFlightPromiseBySegment = new Map<string, Promise<void>>();
  const inFlightRequestIdBySegment = new Map<string, string>();
  const editingSegments = new Set<string>();

  const notifyStateChange = () => {
    deps.onStateChange?.();
  };

  const nextRequestSeq = (segmentId: string): number => {
    const nextSeq = (latestRequestSeqBySegment.get(segmentId) ?? 0) + 1;
    latestRequestSeqBySegment.set(segmentId, nextSeq);
    return nextSeq;
  };

  const createRequestId = (segmentId: string, requestSeq: number): string =>
    `${segmentId}:${requestSeq}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;

  const trackRequest = (segmentId: string, requestId: string, requestSeq: number): void => {
    const seqByRequestId =
      requestSeqByRequestIdBySegment.get(segmentId) ?? new Map<string, number>();
    seqByRequestId.set(requestId, requestSeq);

    // Bound retained request history to avoid unbounded growth.
    if (seqByRequestId.size > 32) {
      const minKeptSeq = Math.max(1, requestSeq - 8);
      for (const [id, seq] of seqByRequestId.entries()) {
        if (seq < minKeptSeq) {
          seqByRequestId.delete(id);
        }
      }
    }

    requestSeqByRequestIdBySegment.set(segmentId, seqByRequestId);
  };

  const clearDebounceTimer = (segmentId: string): void => {
    const timerId = debounceTimerBySegment.get(segmentId);
    if (timerId === undefined) return;
    clearTimeout(timerId);
    debounceTimerBySegment.delete(segmentId);
    notifyStateChange();
  };

  const runSinglePersist = async (segmentId: string): Promise<void> => {
    const activeRequest = inFlightPromiseBySegment.get(segmentId);
    if (activeRequest) {
      await activeRequest;
    }

    const pending = pendingBySegment.get(segmentId);
    if (!pending) return;
    pendingBySegment.delete(segmentId);
    notifyStateChange();

    const requestSeq = nextRequestSeq(segmentId);
    const clientRequestId = createRequestId(segmentId, requestSeq);
    trackRequest(segmentId, clientRequestId, requestSeq);
    deps.clearSegmentSaveError(segmentId);

    const requestTask = (async () => {
      try {
        await deps.updateSegment(
          pending.segmentId,
          pending.targetTokens,
          pending.status,
          clientRequestId,
        );
        if ((latestRequestSeqBySegment.get(segmentId) ?? 0) === requestSeq) {
          deps.clearSegmentSaveError(segmentId);
        }
      } catch (error) {
        if ((latestRequestSeqBySegment.get(segmentId) ?? 0) === requestSeq) {
          const message = error instanceof Error ? error.message : String(error);
          deps.setSegmentSaveError(segmentId, `保存失败：${message}`);
        }
      } finally {
        if (inFlightRequestIdBySegment.get(segmentId) === clientRequestId) {
          inFlightPromiseBySegment.delete(segmentId);
          inFlightRequestIdBySegment.delete(segmentId);
        }
        notifyStateChange();
      }
    })();

    inFlightPromiseBySegment.set(segmentId, requestTask);
    inFlightRequestIdBySegment.set(segmentId, clientRequestId);
    notifyStateChange();
    await requestTask;
  };

  return {
    queueSegmentUpdate: (input) => {
      pendingBySegment.set(input.segmentId, input);
      const existingTimer = debounceTimerBySegment.get(input.segmentId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }
      const timerId = setTimeout(() => {
        debounceTimerBySegment.delete(input.segmentId);
        notifyStateChange();
        void (async () => {
          await runSinglePersist(input.segmentId);
          if (pendingBySegment.has(input.segmentId)) {
            await runSinglePersist(input.segmentId);
          }
        })();
      }, persistDebounceMs);
      debounceTimerBySegment.set(input.segmentId, timerId);
      notifyStateChange();
    },

    flushSegment: async (segmentId) => {
      clearDebounceTimer(segmentId);

      const inFlight = inFlightPromiseBySegment.get(segmentId);
      if (inFlight) {
        await inFlight;
      }

      if (!pendingBySegment.has(segmentId)) return;
      await runSinglePersist(segmentId);
    },

    flushAll: async () => {
      const targetSegmentIds = new Set<string>([
        ...pendingBySegment.keys(),
        ...inFlightPromiseBySegment.keys(),
      ]);
      await Promise.all(
        [...targetSegmentIds].map(async (segmentId) => {
          clearDebounceTimer(segmentId);
          const inFlight = inFlightPromiseBySegment.get(segmentId);
          if (inFlight) {
            await inFlight;
          }
          if (pendingBySegment.has(segmentId)) {
            await runSinglePersist(segmentId);
          }
        }),
      );
    },

    setSegmentEditing: (segmentId, editing) => {
      if (editing) {
        if (!editingSegments.has(segmentId)) {
          editingSegments.add(segmentId);
          notifyStateChange();
        }
        return;
      }

      if (editingSegments.delete(segmentId)) {
        notifyStateChange();
      }
    },

    shouldDelayRemoteUpdate: (segmentId) =>
      pendingBySegment.has(segmentId) ||
      debounceTimerBySegment.has(segmentId) ||
      inFlightPromiseBySegment.has(segmentId),

    isRemoteUpdateStale: (segmentId, clientRequestId) => {
      if (!clientRequestId) return false;
      const seqByRequestId = requestSeqByRequestIdBySegment.get(segmentId);
      if (!seqByRequestId) return false;
      const eventSeq = seqByRequestId.get(clientRequestId);
      if (eventSeq === undefined) return false;
      return eventSeq < (latestRequestSeqBySegment.get(segmentId) ?? 0);
    },

    clear: () => {
      for (const timerId of debounceTimerBySegment.values()) {
        clearTimeout(timerId);
      }
      pendingBySegment.clear();
      debounceTimerBySegment.clear();
      latestRequestSeqBySegment.clear();
      requestSeqByRequestIdBySegment.clear();
      inFlightPromiseBySegment.clear();
      inFlightRequestIdBySegment.clear();
      editingSegments.clear();
      notifyStateChange();
    },
  };
}

interface UseSegmentPersistenceParams {
  setSegments: Dispatch<SetStateAction<Segment[]>>;
  setSegmentSaveError: (segmentId: string, message: string) => void;
  clearSegmentSaveError: (segmentId: string) => void;
}

export function useSegmentPersistence({
  setSegments,
  setSegmentSaveError,
  clearSegmentSaveError,
}: UseSegmentPersistenceParams) {
  const [syncStateVersion, setSyncStateVersion] = useState(0);

  const persistor = useMemo(
    () =>
      createSegmentPersistor({
        updateSegment: (segmentId, targetTokens, status, clientRequestId) =>
          apiClient.updateSegment(segmentId, targetTokens, status, clientRequestId),
        setSegmentSaveError,
        clearSegmentSaveError,
        onStateChange: () => {
          setSyncStateVersion((prev) => prev + 1);
        },
        debounceMs: DEFAULT_PERSIST_DEBOUNCE_MS,
      }),
    [clearSegmentSaveError, setSegmentSaveError],
  );

  const applyOptimisticSegmentUpdate = useCallback(
    (segmentId: string, updater: (segment: Segment) => Segment) => {
      let nextSegment: Segment | undefined;

      setSegments((prev) =>
        prev.map((segment): Segment => {
          if (segment.segmentId !== segmentId) return segment;
          nextSegment = updater(segment);
          return nextSegment;
        }),
      );

      if (!nextSegment) {
        return;
      }

      persistor.queueSegmentUpdate({
        segmentId,
        targetTokens: nextSegment.targetTokens,
        status: nextSegment.status,
      });
    },
    [persistor, setSegments],
  );

  const setSegmentEditingState = useCallback(
    (segmentId: string, editing: boolean) => {
      persistor.setSegmentEditing(segmentId, editing);
    },
    [persistor],
  );

  const flushSegmentUpdate = useCallback(
    async (segmentId: string) => {
      await persistor.flushSegment(segmentId);
    },
    [persistor],
  );

  const flushAllSegmentUpdates = useCallback(async () => {
    await persistor.flushAll();
  }, [persistor]);

  return {
    applyOptimisticSegmentUpdate,
    setSegmentEditingState,
    flushSegmentUpdate,
    flushAllSegmentUpdates,
    shouldDelayRemoteUpdate: persistor.shouldDelayRemoteUpdate,
    isRemoteUpdateStale: persistor.isRemoteUpdateStale,
    syncStateVersion,
    clearPersistQueue: persistor.clear,
  };
}
