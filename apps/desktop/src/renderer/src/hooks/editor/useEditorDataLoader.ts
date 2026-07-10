import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type { SegmentQaRuleId } from '@cat/core/project';
import { DEFAULT_PROJECT_QA_SETTINGS } from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import { apiClient } from '../../services/apiClient';
import type { SetSegmentsWithChangeHint } from './editorSegmentState';
import type { EditorSegmentChange, EditorSegmentStore } from './editorSegmentStore';

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

interface ApplyBatchSegmentUpdatesParams {
  finalState: Map<string, BatchSegmentAction>;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  directContext: string;
  propagationContext: string;
}

export function applyBatchSegmentUpdatesToStore({
  store,
  finalState,
  normalizeTokens,
  normalizeStatus,
  directContext,
  propagationContext,
}: ApplyBatchSegmentUpdatesParams & {
  store: EditorSegmentStore;
}): EditorSegmentChange[] {
  const updates = new Map<string, Segment>();

  for (const [segmentId, entry] of finalState) {
    const segment = store.getSegment(segmentId);
    if (!segment) continue;

    const nextSegment =
      entry.type === 'direct'
        ? applyDirectSegmentUpdate({
            segment,
            event: entry.event,
            normalizeTokens,
            normalizeStatus,
            context: directContext,
          })
        : applyPropagatedSegmentUpdate({
            segment,
            event: entry.event,
            normalizeTokens,
            context: propagationContext,
          });
    updates.set(segmentId, nextSegment);
  }

  return store.applyUpdates(updates);
}

function applyDirectSegmentUpdate(params: {
  segment: Segment;
  event: SegmentsUpdatedEvent;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  context: string;
}): Segment {
  const targetTokens = params.normalizeTokens(
    params.event.targetTokens,
    `segment ${params.segment.segmentId} target (${params.context})`,
  );
  const nextStatus = params.normalizeStatus(params.event.status, targetTokens);
  return {
    ...params.segment,
    targetTokens,
    status: nextStatus,
    qaIssues: nextStatus === 'confirmed' ? params.segment.qaIssues : undefined,
    autoFixSuggestions: nextStatus === 'confirmed' ? params.segment.autoFixSuggestions : undefined,
  };
}

function applyPropagatedSegmentUpdate(params: {
  segment: Segment;
  event: SegmentsUpdatedEvent;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  context: string;
}): Segment {
  const targetTokens = params.normalizeTokens(
    params.event.targetTokens,
    `segment ${params.segment.segmentId} target (${params.context})`,
  );
  return {
    ...params.segment,
    targetTokens,
    status: 'draft' as SegmentStatus,
    qaIssues: undefined,
    autoFixSuggestions: undefined,
  };
}

const SEGMENT_PAGE_SIZE = 1000;

interface UseEditorDataLoaderParams {
  activeFileId: number | null;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  segmentStore: EditorSegmentStore;
  onSegmentsChanged: (changes: readonly EditorSegmentChange[]) => void;
  setSegments: SetSegmentsWithChangeHint;
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
  segmentStore,
  onSegmentsChanged,
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
      const finalState = buildBatchFinalState([data]);

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

      const changes = applyBatchSegmentUpdatesToStore({
        store: segmentStore,
        finalState,
        normalizeTokens,
        normalizeStatus,
        directContext: 'update',
        propagationContext: 'propagation',
      });
      onSegmentsChanged(changes);
    },
    [normalizeStatus, normalizeTokens, onSegmentsChanged, segmentStore, setSegmentSaveErrors],
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

      const changes = applyBatchSegmentUpdatesToStore({
        store: segmentStore,
        finalState,
        normalizeTokens,
        normalizeStatus,
        directContext: 'batch-update',
        propagationContext: 'batch-propagation',
      });
      onSegmentsChanged(changes);
    },
    [normalizeStatus, normalizeTokens, onSegmentsChanged, segmentStore, setSegmentSaveErrors],
  );

  const loadEditorData = useCallback(async () => {
    if (activeFileId === null) {
      setSegments([], { orderChanged: true });
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
      setSegments(normalized, { orderChanged: true });
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
