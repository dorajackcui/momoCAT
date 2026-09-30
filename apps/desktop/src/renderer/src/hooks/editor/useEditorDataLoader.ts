import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type { TagPolicy } from '@cat/core/tag';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import { apiClient } from '../../services/apiClient';
import type { EditorSegmentStore } from './editorSegmentStore';
import {
  applyBatchSegmentUpdatesToStore,
  buildBatchFinalState,
  applyConfirmedSegmentUpdate,
  handleIncomingSegmentsUpdatedBatch,
  handleIncomingSegmentsUpdatedEvent,
  drainQueuedSegmentsUpdatedEvents,
  type RemoteUpdateQueueHandlers,
  type BatchSegmentAction,
} from './editorRemoteUpdates';

const SEGMENT_PAGE_SIZE = 1000;

interface UseEditorDataLoaderParams {
  activeFileId: number | null;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  segmentStore: EditorSegmentStore;
  setProjectId: Dispatch<SetStateAction<number | null>>;
  setFileTagPolicy: Dispatch<SetStateAction<TagPolicy>>;
  setSegmentSaveErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  subscribeSyncState: (listener: () => void) => () => void;
  clearPersistQueue: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
}

export function useEditorDataLoader({
  activeFileId,
  normalizeTokens,
  normalizeStatus,
  segmentStore,
  setProjectId,
  setFileTagPolicy,
  setSegmentSaveErrors,
  setActiveSegmentId,
  shouldDelayRemoteUpdate,
  isRemoteUpdateStale,
  subscribeSyncState,
  clearPersistQueue,
  setLoading,
}: UseEditorDataLoaderParams): {
  loadEditorData: () => Promise<void>;
  applyConfirmation: (data: SegmentsUpdatedEvent, accept?: (id: string) => boolean) => void;
  applySelectedUpdates: (data: SegmentsUpdatedEvent[]) => void;
} {
  const queuedRemoteUpdatesRef = useRef<Map<string, SegmentsUpdatedEvent>>(new Map());
  const loadedProjectId = useRef<number | null>(null);
  useEffect(() => {
    loadedProjectId.current = null;
    const invalidate = (projectId: number | null) => {
      if (projectId !== null && projectId !== loadedProjectId.current) return;
      segmentStore.invalidateQA();
    };
    const offQA = apiClient.onQAInvalidated?.(invalidate);
    const offTB = apiClient.onReferenceDataChanged?.((event) => {
      if (event.kind === 'tb') invalidate(event.projectId);
    });
    return () => {
      offQA?.();
      offTB?.();
    };
  }, [activeFileId, segmentStore]);

  const applyFinalState = useCallback(
    (finalState: Map<string, BatchSegmentAction>) => {
      setSegmentSaveErrors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const segmentId of finalState.keys()) {
          if (next[segmentId]) {
            delete next[segmentId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      applyBatchSegmentUpdatesToStore({
        store: segmentStore,
        finalState,
        normalizeTokens,
        normalizeStatus,
        directContext: 'batch-update',
        propagationContext: 'batch-propagation',
      });
    },
    [normalizeStatus, normalizeTokens, segmentStore, setSegmentSaveErrors],
  );

  const applySegmentsUpdatedBatch = useCallback(
    (batch: SegmentsUpdatedEvent[]) => applyFinalState(buildBatchFinalState(batch)),
    [applyFinalState],
  );

  const applySegmentsUpdatedEvent = useCallback(
    (data: SegmentsUpdatedEvent) => applySegmentsUpdatedBatch([data]),
    [applySegmentsUpdatedBatch],
  );
  const loadGeneration = useRef(0);
  const loadEditorData = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current;
    clearPersistQueue();
    queuedRemoteUpdatesRef.current.clear();
    if (activeFileId === null) {
      segmentStore.replaceAll([]);
      setProjectId(null);
      setFileTagPolicy('default');
      setSegmentSaveErrors({});
      setLoading(false);
      return;
    }

    setLoading(true);
    segmentStore.replaceAll([]);
    try {
      const file = await apiClient.getFile(activeFileId);
      if (!isCurrent()) return;
      setFileTagPolicy(file ? resolveFileTagPolicy(file) : 'default');
      if (file) {
        setProjectId(file.projectId);
        loadedProjectId.current = file.projectId;
      } else {
        setProjectId(null);
      }

      const segmentsArray: Segment[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await apiClient.getSegments(activeFileId, offset, SEGMENT_PAGE_SIZE);
        if (!isCurrent()) return;
        const pageArray = Array.isArray(page) ? page : [];
        if (pageArray.length === 0) break;
        segmentsArray.push(...pageArray);
        hasMore = pageArray.length === SEGMENT_PAGE_SIZE;
        offset += SEGMENT_PAGE_SIZE;
      }

      const normalized = segmentsArray.map((segment) => {
        const sourceTokens = normalizeTokens(
          segment.sourceTokens,
          `segment ${segment.segmentId} source`,
        );
        const targetTokens = normalizeTokens(
          segment.targetTokens,
          `segment ${segment.segmentId} target`,
        );
        return {
          ...segment,
          sourceTokens,
          targetTokens,
          status: normalizeStatus(segment.status, targetTokens),
        };
      });
      segmentStore.replaceAll(normalized);
      setSegmentSaveErrors({});
      clearPersistQueue();
      queuedRemoteUpdatesRef.current.clear();
      setActiveSegmentId((prev) => {
        if (prev && normalized.some((segment) => segment.segmentId === prev)) return prev;
        return normalized.length > 0 ? normalized[0].segmentId : null;
      });
    } catch (error) {
      console.error('Failed to load editor data:', error);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [
    activeFileId,
    clearPersistQueue,
    normalizeStatus,
    normalizeTokens,
    setActiveSegmentId,

    setFileTagPolicy,

    setLoading,
    setProjectId,
    setSegmentSaveErrors,
    segmentStore,
  ]);

  useEffect(() => {
    void loadEditorData();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadEditorData]);

  useEffect(() => {
    const handlers: RemoteUpdateQueueHandlers = {
      activeFileId,
      queuedRemoteUpdates: queuedRemoteUpdatesRef.current,
      shouldDelayRemoteUpdate,
      isRemoteUpdateStale,
      applySegmentsUpdatedEvent,
      applySegmentsUpdatedBatch,
    };

    const unsubBatch = apiClient.onSegmentsUpdatedBatch((batch) => {
      handleIncomingSegmentsUpdatedBatch(batch, handlers);
    });

    const unsubSingle = apiClient.onSegmentsUpdated((data) => {
      handleIncomingSegmentsUpdatedEvent(data, handlers);
    });

    return () => {
      unsubBatch();
      unsubSingle();
    };
  }, [
    activeFileId,
    applySegmentsUpdatedEvent,
    applySegmentsUpdatedBatch,
    isRemoteUpdateStale,
    shouldDelayRemoteUpdate,
  ]);

  useEffect(() => {
    const drain = () => {
      if (!queuedRemoteUpdatesRef.current.size) return;
      drainQueuedSegmentsUpdatedEvents({
        activeFileId,
        queuedRemoteUpdates: queuedRemoteUpdatesRef.current,
        shouldDelayRemoteUpdate,
        isRemoteUpdateStale,
        applySegmentsUpdatedEvent,
        applySegmentsUpdatedBatch,
      });
    };
    drain();
    return subscribeSyncState(drain);
  }, [
    activeFileId,
    shouldDelayRemoteUpdate,
    isRemoteUpdateStale,
    applySegmentsUpdatedEvent,
    applySegmentsUpdatedBatch,
    subscribeSyncState,
  ]);

  const applyConfirmation = useCallback(
    (data: SegmentsUpdatedEvent, accept: (id: string) => boolean = () => true) => {
      applyConfirmedSegmentUpdate(
        data,
        {
          activeFileId,
          queuedRemoteUpdates: queuedRemoteUpdatesRef.current,
          applyFinalState,
        },
        accept,
      );
    },
    [activeFileId, applyFinalState],
  );

  const applySelectedUpdates = useCallback(
    (events: SegmentsUpdatedEvent[]) => {
      const current = events.filter((event) => event.fileId === activeFileId);
      for (const event of current) queuedRemoteUpdatesRef.current.delete(event.segmentId);
      applySegmentsUpdatedBatch(current);
    },
    [activeFileId, applySegmentsUpdatedBatch],
  );

  return { loadEditorData, applyConfirmation, applySelectedUpdates };
}
