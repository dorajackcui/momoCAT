import { useCallback, useMemo } from 'react';
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

export interface SegmentOperation {
  clientRequestId: string;
  isCurrent: (segmentId?: string) => boolean;
}

interface SegmentPersistor {
  queueSegmentUpdate: (input: QueueSegmentUpdateInput) => void;
  flushSegment: (segmentId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  setSegmentEditing: (segmentId: string, editing: boolean) => void;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
  beginOperation: (segmentId: string) => SegmentOperation;
  runCommit: <T>(
    segmentId: string,
    task: (operation: SegmentOperation) => Promise<T>,
  ) => Promise<T>;
}

export function createSegmentPersistor(deps: SegmentPersistorDeps): SegmentPersistor {
  const persistDebounceMs = deps.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
  const pendingBySegment = new Map<string, QueueSegmentUpdateInput>();
  const debounceTimerBySegment = new Map<string, ReturnType<typeof setTimeout>>();
  const latestRequestSeqBySegment = new Map<string, number>();
  const inFlightPromiseBySegment = new Map<string, Promise<void>>();
  const inFlightRequestIdBySegment = new Map<string, string>();
  const editingSegments = new Set<string>();
  let generation = 0;
  let requestSequence = 0;
  let editVersion = 0;
  const editedAt = new Map<string, number>();
  const commits = new Map<string, Promise<unknown>>();
  const listeners = new Set<() => void>();
  let notificationPending = false;

  const notifyStateChange = () => {
    deps.onStateChange?.();
    if (!notificationPending) {
      notificationPending = true;
      queueMicrotask(() => {
        notificationPending = false;
        for (const listener of [...listeners]) listener();
      });
    }
  };

  const nextRequestSeq = (segmentId: string): number => {
    const nextSeq = ++requestSequence;
    latestRequestSeqBySegment.set(segmentId, nextSeq);
    return nextSeq;
  };

  // Opaque identities carry this editor session's revision, so even very late
  // echoes remain recognizable without an unbounded or prematurely pruned history.
  const requestPrefix = `editor-${Date.now()}-${Math.random().toString(16).slice(2)}:`;
  const createRequestId = (segmentId: string, seq: number, owned = false): string =>
    `${requestPrefix}${generation}:${seq}:${editedAt.get(segmentId) ?? 0}:${Number(owned)}`;

  const beginOperation = (segmentId: string): SegmentOperation => {
    const seq = nextRequestSeq(segmentId);
    const clientRequestId = createRequestId(segmentId, seq, true);
    const startedAt = editVersion;
    const scope = generation;
    return {
      clientRequestId,
      isCurrent: (id = segmentId) =>
        scope === generation &&
        (editedAt.get(id) ?? 0) <= startedAt &&
        (latestRequestSeqBySegment.get(id) ?? 0) <= seq,
    };
  };

  const clearDebounceTimer = (segmentId: string): void => {
    const timerId = debounceTimerBySegment.get(segmentId);
    if (timerId === undefined) return;
    clearTimeout(timerId);
    debounceTimerBySegment.delete(segmentId);
    notifyStateChange();
  };

  const runSinglePersist = async (segmentId: string): Promise<void> => {
    // A newer draft waits for an explicit commit, so persisted order matches edit order.
    const commit = commits.get(segmentId);
    if (commit) await commit.catch(() => {});
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
    deps.clearSegmentSaveError(segmentId);

    const requestGeneration = generation;
    // Store the rejecting promise shared by every waiter. Deferring its start
    // also installs the in-flight state before a synchronous adapter failure.
    const requestTask = Promise.resolve().then(async () => {
      try {
        await deps.updateSegment(
          pending.segmentId,
          pending.targetTokens,
          pending.status,
          clientRequestId,
        );
        if (
          generation === requestGeneration &&
          (latestRequestSeqBySegment.get(segmentId) ?? 0) === requestSeq
        ) {
          deps.clearSegmentSaveError(segmentId);
        }
      } catch (error) {
        if (generation === requestGeneration) {
          // Keep failed edits dirty and retryable without replacing a newer draft.
          if (!pendingBySegment.has(segmentId)) {
            pendingBySegment.set(segmentId, pending);
          }
          const message = error instanceof Error ? error.message : String(error);
          deps.setSegmentSaveError(segmentId, `保存失败：${message}`);
        }
        throw error;
      } finally {
        if (inFlightRequestIdBySegment.get(segmentId) === clientRequestId) {
          inFlightPromiseBySegment.delete(segmentId);
          inFlightRequestIdBySegment.delete(segmentId);
        }
        notifyStateChange();
      }
    });

    inFlightPromiseBySegment.set(segmentId, requestTask);
    inFlightRequestIdBySegment.set(segmentId, clientRequestId);
    notifyStateChange();
    await requestTask;
  };

  const flushSegment = async (segmentId: string): Promise<void> => {
    do {
      clearDebounceTimer(segmentId);
      const commit = commits.get(segmentId);
      if (commit) await commit;
      const inFlight = inFlightPromiseBySegment.get(segmentId);
      if (inFlight) await inFlight;
      if (pendingBySegment.has(segmentId)) await runSinglePersist(segmentId);
      // Input may arrive during a save. Explicit actions require the latest draft.
    } while (
      pendingBySegment.has(segmentId) ||
      inFlightPromiseBySegment.has(segmentId) ||
      commits.has(segmentId)
    );
  };

  return {
    beginOperation,
    runCommit: async (segmentId, task) => {
      const previous = commits.get(segmentId);
      if (previous) await previous.catch(() => {});
      const operation = beginOperation(segmentId);
      const promise = Promise.resolve().then(() => task(operation));
      commits.set(segmentId, promise);
      notifyStateChange();
      try {
        return await promise;
      } finally {
        if (commits.get(segmentId) === promise) commits.delete(segmentId);
        notifyStateChange();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    queueSegmentUpdate: (input) => {
      editedAt.set(input.segmentId, ++editVersion);
      pendingBySegment.set(input.segmentId, input);
      const existingTimer = debounceTimerBySegment.get(input.segmentId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }
      const timerId = setTimeout(() => {
        debounceTimerBySegment.delete(input.segmentId);
        notifyStateChange();
        void (async () => {
          try {
            await runSinglePersist(input.segmentId);
            if (pendingBySegment.has(input.segmentId)) {
              await runSinglePersist(input.segmentId);
            }
          } catch {
            // Error already recorded via setSegmentSaveError
          }
        })();
      }, persistDebounceMs);
      debounceTimerBySegment.set(input.segmentId, timerId);
      notifyStateChange();
    },

    flushSegment,
    flushAll: async () => {
      while (true) {
        const ids = new Set([
          ...pendingBySegment.keys(),
          ...inFlightPromiseBySegment.keys(),
          ...commits.keys(),
        ]);
        if (!ids.size) return;
        const results = await Promise.allSettled([...ids].map(flushSegment));
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) throw new Error(`${failures.length} segment(s) failed to save`);
      }
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
      editingSegments.has(segmentId) ||
      pendingBySegment.has(segmentId) ||
      debounceTimerBySegment.has(segmentId) ||
      inFlightPromiseBySegment.has(segmentId) ||
      commits.has(segmentId),

    isRemoteUpdateStale: (segmentId, clientRequestId) => {
      if (!clientRequestId?.startsWith(requestPrefix)) return false;
      const [requestGeneration, seq, edit, owned] = clientRequestId
        .slice(requestPrefix.length)
        .split(':')
        .map(Number);
      return (
        requestGeneration !== generation ||
        owned === 1 ||
        edit < (editedAt.get(segmentId) ?? 0) ||
        seq < (latestRequestSeqBySegment.get(segmentId) ?? 0)
      );
    },

    clear: () => {
      generation += 1;
      for (const timerId of debounceTimerBySegment.values()) {
        clearTimeout(timerId);
      }
      pendingBySegment.clear();
      debounceTimerBySegment.clear();
      latestRequestSeqBySegment.clear();
      inFlightPromiseBySegment.clear();
      inFlightRequestIdBySegment.clear();
      editingSegments.clear();
      editedAt.clear();
      commits.clear();
      notifyStateChange();
    },
  };
}

interface UseSegmentPersistenceParams {
  updateSegmentState: (
    segmentId: string,
    updater: (segment: Segment) => Segment,
  ) => Segment | undefined;
  setSegmentSaveError: (segmentId: string, message: string) => void;
  clearSegmentSaveError: (segmentId: string) => void;
}

export function useSegmentPersistence({
  updateSegmentState,
  setSegmentSaveError,
  clearSegmentSaveError,
}: UseSegmentPersistenceParams) {
  const persistor = useMemo(
    () =>
      createSegmentPersistor({
        updateSegment: (segmentId, targetTokens, status, clientRequestId) =>
          apiClient.updateSegment(segmentId, targetTokens, status, clientRequestId),
        setSegmentSaveError,
        clearSegmentSaveError,
        debounceMs: DEFAULT_PERSIST_DEBOUNCE_MS,
      }),
    [clearSegmentSaveError, setSegmentSaveError],
  );

  const applyOptimisticSegmentUpdate = useCallback(
    (segmentId: string, updater: (segment: Segment) => Segment) => {
      const updatedSegment = updateSegmentState(segmentId, updater);

      if (!updatedSegment) {
        return;
      }

      persistor.queueSegmentUpdate({
        segmentId,
        targetTokens: updatedSegment.targetTokens,
        status: updatedSegment.status,
      });
    },
    [persistor, updateSegmentState],
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
    subscribeSyncState: persistor.subscribe,
    beginOperation: persistor.beginOperation,
    runCommit: persistor.runCommit,
    clearPersistQueue: persistor.clear,
  };
}
