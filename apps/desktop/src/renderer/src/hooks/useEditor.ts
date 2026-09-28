import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Token } from '@cat/core/models';
import { normalizeSegmentStatus } from '@cat/core/models';
import type { TagPolicy } from '@cat/core/tag';
import {
  appendTermToTargetTokens,
  normalizeEditorInputText,
  parseTargetEditorText,
} from './editor/editorTokenPolicy';
import { useSegmentPersistence } from './editor/useSegmentPersistence';
import { createEditorSegmentStore } from './editor/editorSegmentStore';
import { useSegmentAI } from './editor/useSegmentAI';
import { useEditorDataLoader } from './editor/useEditorDataLoader';
import { useSegmentConfirmation } from './editor/useSegmentConfirmation';
import { refreshInstantQA } from './editor/refreshInstantQA';
import { useSelectedSegmentActions } from './editor/useSelectedSegmentActions';

interface UseEditorProps {
  activeFileId: number | null;
}

export function useEditor({ activeFileId }: UseEditorProps) {
  const [segmentStore] = useState(() => createEditorSegmentStore());
  const segmentStats = useSyncExternalStore(segmentStore.subscribe, segmentStore.getStats);
  const orderIds = useSyncExternalStore(segmentStore.subscribe, segmentStore.getOrderIds);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [fileTagPolicy, setFileTagPolicy] = useState<TagPolicy>('default');
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [segmentSaveErrors, setSegmentSaveErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const isTokenLike = useCallback((value: unknown): value is Token => {
    if (!value || typeof value !== 'object') return false;
    const tokenCandidate = value as { type?: unknown; content?: unknown };
    return typeof tokenCandidate.type === 'string' && typeof tokenCandidate.content === 'string';
  }, []);

  const normalizeTokens = useCallback(
    (tokens: unknown, context: string): Token[] => {
      if (!Array.isArray(tokens)) {
        console.warn(`[useEditor] ${context} tokens not array`, tokens);
        return [];
      }
      const cleaned = tokens.filter(isTokenLike);
      if (cleaned.length !== tokens.length) {
        console.warn(`[useEditor] ${context} tokens contained invalid entries`, tokens);
      }
      return cleaned;
    },
    [isTokenLike],
  );

  const normalizeStatus = normalizeSegmentStatus;

  const setSegmentSaveError = useCallback((segmentId: string, message: string) => {
    setSegmentSaveErrors((prev) => {
      if (prev[segmentId] === message) return prev;
      return {
        ...prev,
        [segmentId]: message,
      };
    });
  }, []);

  const clearSegmentSaveError = useCallback((segmentId: string) => {
    setSegmentSaveErrors((prev) => {
      if (!prev[segmentId]) return prev;
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  }, []);

  const {
    applyOptimisticSegmentUpdate,
    setSegmentEditingState,
    flushSegmentUpdate,
    flushAllSegmentUpdates,
    shouldDelayRemoteUpdate,
    isRemoteUpdateStale,
    subscribeSyncState,
    beginOperation,
    runCommit,
    clearPersistQueue,
  } = useSegmentPersistence({
    updateSegmentState: segmentStore.updateSegment,
    setSegmentSaveError,
    clearSegmentSaveError,
  });

  const { loadEditorData, applyConfirmation, applySelectedUpdates } = useEditorDataLoader({
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
  });

  const refreshConfirmedQA = useCallback(
    (ids: string[]) => {
      void refreshInstantQA(ids, segmentStore);
    },
    [segmentStore],
  );
  const handleConfirmed = useCallback(
    (event: Parameters<typeof applyConfirmation>[0], accept: (id?: string) => boolean) => {
      applyConfirmation(event, accept);
      if (accept(event.segmentId)) refreshConfirmedQA([event.segmentId]);
    },
    [applyConfirmation, refreshConfirmedQA],
  );

  const { confirmSegment } = useSegmentConfirmation({
    store: segmentStore,
    flushPending: flushAllSegmentUpdates,
    runCommit,
    setSegmentSaveError,
    clearSegmentSaveError,
    onConfirmed: handleConfirmed,
  });

  const selectedActions = useSelectedSegmentActions({
    fileId: activeFileId,
    getSegment: segmentStore.getSegment,
    flushPending: flushAllSegmentUpdates,
    applyUpdates: applySelectedUpdates,
    onConfirmed: refreshConfirmedQA,
    clearSaveError: clearSegmentSaveError,
    tagPolicy: fileTagPolicy,
  });

  useEffect(
    () => () => {
      void flushAllSegmentUpdates().catch(() => {});
    },
    [flushAllSegmentUpdates],
  );

  useEffect(() => {
    const flushPendingChanges = () => {
      void flushAllSegmentUpdates().catch(() => {});
    };
    window.addEventListener('beforeunload', flushPendingChanges);
    window.addEventListener('pagehide', flushPendingChanges);
    return () => {
      window.removeEventListener('beforeunload', flushPendingChanges);
      window.removeEventListener('pagehide', flushPendingChanges);
    };
  }, [flushAllSegmentUpdates]);

  const handleTranslationChange = useCallback(
    (segmentId: string, text: string) => {
      try {
        applyOptimisticSegmentUpdate(segmentId, (segment) => {
          const normalizedText = normalizeEditorInputText(text);
          const tokens = parseTargetEditorText(normalizedText, segment.sourceTokens, fileTagPolicy);
          const nextStatus = normalizeSegmentStatus('draft', tokens);
          return {
            ...segment,
            targetTokens: tokens,
            status: nextStatus,
          };
        });
      } catch (error) {
        console.error('Error in handleTranslationChange:', error);
        console.error('Segment ID:', segmentId);
        console.error('Text:', text);
      }
    },
    [applyOptimisticSegmentUpdate, fileTagPolicy],
  );

  const handleSegmentEditStateChange = useCallback(
    (segmentId: string, editing: boolean) => {
      setSegmentEditingState(segmentId, editing);
    },
    [setSegmentEditingState],
  );

  const flushSegmentDraft = useCallback(
    async (segmentId: string) => {
      await flushSegmentUpdate(segmentId);
    },
    [flushSegmentUpdate],
  );

  const handleApplyMatch = useCallback(
    (tokens: Token[]) => {
      if (!activeSegmentId) return;

      applyOptimisticSegmentUpdate(activeSegmentId, (segment) => ({
        ...segment,
        targetTokens: tokens,
        status: normalizeSegmentStatus('draft', tokens),
      }));
    },
    [activeSegmentId, applyOptimisticSegmentUpdate],
  );

  const handleApplyTerm = useCallback(
    (term: string) => {
      if (!activeSegmentId) return;

      applyOptimisticSegmentUpdate(activeSegmentId, (segment) => {
        const nextTokens = appendTermToTargetTokens(segment, term, fileTagPolicy);
        const nextStatus = normalizeSegmentStatus('draft', nextTokens);

        return {
          ...segment,
          targetTokens: nextTokens,
          status: nextStatus,
        };
      });
    },
    [activeSegmentId, applyOptimisticSegmentUpdate, fileTagPolicy],
  );

  const getActiveSegment = () =>
    activeSegmentId ? segmentStore.getSegment(activeSegmentId) : undefined;

  const ai = useSegmentAI({
    fileId: activeFileId,
    store: segmentStore,
    flushSegment: flushSegmentUpdate,
    beginOperation,
    setSaveError: setSegmentSaveError,
    clearSaveError: clearSegmentSaveError,
  });

  return {
    segments: segmentStore.getSegments(),
    orderIds,
    ...selectedActions,
    segmentStore,
    segmentIndexById: segmentStore.getIndexById(),
    segmentStats,
    fileTagPolicy,
    projectId,
    activeSegmentId,
    segmentSaveErrors,
    setActiveSegmentId,
    loading,
    ...ai,
    handleTranslationChange,
    handleSegmentEditStateChange,
    flushSegmentDraft,
    flushPendingSegmentUpdates: flushAllSegmentUpdates,
    confirmSegment,
    handleApplyMatch,
    handleApplyTerm,
    getActiveSegment,
    reloadEditorData: loadEditorData,
  };
}
