import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type { SegmentQaRuleId } from '@cat/core/project';
import { DEFAULT_PROJECT_QA_SETTINGS } from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import { apiClient } from '../../services/apiClient';

export type BatchSegmentAction =
  | { type: 'direct'; event: SegmentsUpdatedEvent }
  | { type: 'propagation'; event: SegmentsUpdatedEvent };

export function buildBatchFinalState(
  batch: SegmentsUpdatedEvent[],
): Map<string, BatchSegmentAction> {
  const finalState = new Map<string, BatchSegmentAction>();
  for (const data of batch) {
    finalState.set(data.segmentId, { type: 'direct', event: data });
    for (const propagatedId of data.propagatedIds ?? []) {
      finalState.set(propagatedId, { type: 'propagation', event: data });
    }
  }
  return finalState;
}

const SEGMENT_PAGE_SIZE = 1000;

interface UseEditorDataLoaderParams {
  activeFileId: number | null;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  setSegments: Dispatch<SetStateAction<Segment[]>>;
  setProjectId: Dispatch<SetStateAction<number | null>>;
  setProjectTgtLang: Dispatch<SetStateAction<string | null>>;
  setEnabledQaRuleIds: Dispatch<SetStateAction<SegmentQaRuleId[]>>;
  setInstantQaOnConfirm: Dispatch<SetStateAction<boolean>>;
  setFileTagPolicy: Dispatch<SetStateAction<TagPolicy>>;
  setSegmentSaveErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setAiTranslatingSegmentIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  syncStateVersion: number;
  clearPersistQueue: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
}

interface RemoteUpdateQueueHandlers {
  activeFileId?: number | null;
  queuedRemoteUpdates: Map<string, SegmentsUpdatedEvent>;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  applySegmentsUpdatedEvent: (data: SegmentsUpdatedEvent) => void;
  applySegmentsUpdatedBatch: (batch: SegmentsUpdatedEvent[]) => void;
}

function isSegmentUpdateForActiveFile(
  data: SegmentsUpdatedEvent,
  activeFileId: number | null | undefined,
): boolean {
  if (activeFileId === undefined) return true;
  if (activeFileId === null) return false;
  return data.fileId === activeFileId;
}

export function handleIncomingSegmentsUpdatedEvent(
  data: SegmentsUpdatedEvent,
  handlers: RemoteUpdateQueueHandlers,
): 'ignored' | 'stale' | 'queued' | 'applied' {
  if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
    return 'ignored';
  }

  if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
    return 'stale';
  }

  if (handlers.shouldDelayRemoteUpdate(data.segmentId)) {
    handlers.queuedRemoteUpdates.set(data.segmentId, data);
    return 'queued';
  }

  handlers.applySegmentsUpdatedEvent(data);
  return 'applied';
}

export function handleIncomingSegmentsUpdatedBatch(
  batch: SegmentsUpdatedEvent[],
  handlers: RemoteUpdateQueueHandlers,
): { applied: number; queued: number; stale: number } {
  const toApply: SegmentsUpdatedEvent[] = [];
  let queued = 0;
  let stale = 0;

  for (const data of batch) {
    if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
      continue;
    }

    if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
      stale += 1;
      continue;
    }
    if (handlers.shouldDelayRemoteUpdate(data.segmentId)) {
      handlers.queuedRemoteUpdates.set(data.segmentId, data);
      queued += 1;
      continue;
    }
    toApply.push(data);
  }

  if (toApply.length > 0) {
    handlers.applySegmentsUpdatedBatch(toApply);
  }

  return { applied: toApply.length, queued, stale };
}

export function drainQueuedSegmentsUpdatedEvents(handlers: RemoteUpdateQueueHandlers): {
  appliedCount: number;
  droppedStaleCount: number;
} {
  let droppedStaleCount = 0;
  const toApply: SegmentsUpdatedEvent[] = [];
  const queued = [...handlers.queuedRemoteUpdates.values()];

  for (const data of queued) {
    if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
      handlers.queuedRemoteUpdates.delete(data.segmentId);
      continue;
    }

    if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
      handlers.queuedRemoteUpdates.delete(data.segmentId);
      droppedStaleCount += 1;
      continue;
    }

    if (handlers.shouldDelayRemoteUpdate(data.segmentId)) {
      continue;
    }

    handlers.queuedRemoteUpdates.delete(data.segmentId);
    toApply.push(data);
  }

  if (toApply.length > 0) {
    handlers.applySegmentsUpdatedBatch(toApply);
  }

  return { appliedCount: toApply.length, droppedStaleCount };
}

export function useEditorDataLoader({
  activeFileId,
  normalizeTokens,
  normalizeStatus,
  setSegments,
  setProjectId,
  setProjectTgtLang,
  setEnabledQaRuleIds,
  setInstantQaOnConfirm,
  setFileTagPolicy,
  setSegmentSaveErrors,
  setAiTranslatingSegmentIds,
  setActiveSegmentId,
  shouldDelayRemoteUpdate,
  isRemoteUpdateStale,
  syncStateVersion,
  clearPersistQueue,
  setLoading,
}: UseEditorDataLoaderParams): { loadEditorData: () => Promise<void> } {
  const queuedRemoteUpdatesRef = useRef<Map<string, SegmentsUpdatedEvent>>(new Map());

  const applySegmentsUpdatedEvent = useCallback(
    (data: SegmentsUpdatedEvent) => {
      setSegmentSaveErrors((prev) => {
        let changed = false;
        const next = { ...prev };
        if (next[data.segmentId]) {
          delete next[data.segmentId];
          changed = true;
        }
        for (const propagatedId of data.propagatedIds ?? []) {
          if (next[propagatedId]) {
            delete next[propagatedId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      setSegments((prev) => {
        let changed = false;
        const nextSegments: Segment[] = prev.map((segment): Segment => {
          if (segment.segmentId === data.segmentId) {
            changed = true;
            const targetTokens = normalizeTokens(
              data.targetTokens,
              `segment ${segment.segmentId} target (update)`,
            );
            const nextStatus = normalizeStatus(data.status, targetTokens);
            return {
              ...segment,
              targetTokens,
              status: nextStatus,
              qaIssues: nextStatus === 'confirmed' ? segment.qaIssues : undefined,
              autoFixSuggestions:
                nextStatus === 'confirmed' ? segment.autoFixSuggestions : undefined,
            };
          }

          if (data.propagatedIds?.includes(segment.segmentId)) {
            changed = true;
            const targetTokens = normalizeTokens(
              data.targetTokens,
              `segment ${segment.segmentId} target (propagation)`,
            );
            return {
              ...segment,
              targetTokens,
              status: 'draft' as SegmentStatus,
              qaIssues: undefined,
              autoFixSuggestions: undefined,
            };
          }

          return segment;
        });
        return changed ? nextSegments : prev;
      });
    },
    [normalizeStatus, normalizeTokens, setSegmentSaveErrors, setSegments],
  );

  const applySegmentsUpdatedBatch = useCallback(
    (batch: SegmentsUpdatedEvent[]) => {
      const finalState = buildBatchFinalState(batch);

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

      setSegments((prev) => {
        let changed = false;
        const nextSegments: Segment[] = prev.map((segment): Segment => {
          const entry = finalState.get(segment.segmentId);
          if (!entry) return segment;

          changed = true;
          if (entry.type === 'direct') {
            const targetTokens = normalizeTokens(
              entry.event.targetTokens,
              `segment ${segment.segmentId} target (batch-update)`,
            );
            const nextStatus = normalizeStatus(entry.event.status, targetTokens);
            return {
              ...segment,
              targetTokens,
              status: nextStatus,
              qaIssues: nextStatus === 'confirmed' ? segment.qaIssues : undefined,
              autoFixSuggestions:
                nextStatus === 'confirmed' ? segment.autoFixSuggestions : undefined,
            };
          }

          const targetTokens = normalizeTokens(
            entry.event.targetTokens,
            `segment ${segment.segmentId} target (batch-propagation)`,
          );
          return {
            ...segment,
            targetTokens,
            status: 'draft' as SegmentStatus,
            qaIssues: undefined,
            autoFixSuggestions: undefined,
          };
        });
        return changed ? nextSegments : prev;
      });
    },
    [normalizeStatus, normalizeTokens, setSegmentSaveErrors, setSegments],
  );

  const loadEditorData = useCallback(async () => {
    if (activeFileId === null) {
      setSegments([]);
      setProjectId(null);
      setProjectTgtLang(null);
      setEnabledQaRuleIds(DEFAULT_PROJECT_QA_SETTINGS.enabledRuleIds);
      setInstantQaOnConfirm(DEFAULT_PROJECT_QA_SETTINGS.instantQaOnConfirm);
      setFileTagPolicy('default');
      setSegmentSaveErrors({});
      setAiTranslatingSegmentIds({});
      clearPersistQueue();
      queuedRemoteUpdatesRef.current.clear();
      return;
    }

    setLoading(true);
    try {
      const file = await apiClient.getFile(activeFileId);
      setFileTagPolicy(file ? resolveFileTagPolicy(file) : 'default');
      if (file) {
        setProjectId(file.projectId);
        const project = await apiClient.getProject(file.projectId);
        setProjectTgtLang(project?.tgtLang ?? null);
        const qaSettings = project?.qaSettings || DEFAULT_PROJECT_QA_SETTINGS;
        setEnabledQaRuleIds(
          qaSettings.enabledRuleIds || DEFAULT_PROJECT_QA_SETTINGS.enabledRuleIds,
        );
        setInstantQaOnConfirm(
          typeof qaSettings.instantQaOnConfirm === 'boolean'
            ? qaSettings.instantQaOnConfirm
            : DEFAULT_PROJECT_QA_SETTINGS.instantQaOnConfirm,
        );
      } else {
        setProjectId(null);
        setProjectTgtLang(null);
      }

      const segmentsArray: Segment[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await apiClient.getSegments(activeFileId, offset, SEGMENT_PAGE_SIZE);
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
          autoFixSuggestions: undefined,
        };
      });
      setSegments(normalized);
      setSegmentSaveErrors({});
      setAiTranslatingSegmentIds({});
      clearPersistQueue();
      queuedRemoteUpdatesRef.current.clear();
      setActiveSegmentId((prev) => {
        if (prev && normalized.some((segment) => segment.segmentId === prev)) return prev;
        return normalized.length > 0 ? normalized[0].segmentId : null;
      });
    } catch (error) {
      console.error('Failed to load editor data:', error);
    } finally {
      setLoading(false);
    }
  }, [
    activeFileId,
    clearPersistQueue,
    normalizeStatus,
    normalizeTokens,
    setActiveSegmentId,
    setAiTranslatingSegmentIds,
    setEnabledQaRuleIds,
    setFileTagPolicy,
    setInstantQaOnConfirm,
    setLoading,
    setProjectId,
    setProjectTgtLang,
    setSegmentSaveErrors,
    setSegments,
  ]);

  useEffect(() => {
    void loadEditorData();
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
    if (queuedRemoteUpdatesRef.current.size === 0) return;
    drainQueuedSegmentsUpdatedEvents({
      activeFileId,
      queuedRemoteUpdates: queuedRemoteUpdatesRef.current,
      shouldDelayRemoteUpdate,
      isRemoteUpdateStale,
      applySegmentsUpdatedEvent,
      applySegmentsUpdatedBatch,
    });
  }, [
    applySegmentsUpdatedEvent,
    applySegmentsUpdatedBatch,
    activeFileId,
    isRemoteUpdateStale,
    shouldDelayRemoteUpdate,
    syncStateVersion,
  ]);

  return {
    loadEditorData,
  };
}
