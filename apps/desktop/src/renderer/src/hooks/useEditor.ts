import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { DEFAULT_PROJECT_QA_SETTINGS, type SegmentQaRuleId } from '@cat/core/project';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToEditorText, type TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AISegmentTranslateResult } from '../../../shared/ipc';
import { useReferenceLookupController } from './editor/useReferenceLookupController';
import {
  appendTermToTargetTokens,
  normalizeEditorInputText,
  parseTargetEditorText,
} from './editor/editorTokenPolicy';
import {
  createSegmentPersistor,
  resolveSegmentStateUpdate,
  useSegmentPersistence,
} from './editor/useSegmentPersistence';
import {
  assertSegmentChangeHintMatchesUpdate,
  createSegmentChangeHint,
  createSegmentIndexById,
  getIndexedSegment,
  buildSegmentStats,
  updateSegmentStats,
  type SegmentChangeHint,
  type SegmentChangeHintInput,
  type SegmentStats,
} from './editor/editorSegmentState';
import { useEditorDataLoader } from './editor/useEditorDataLoader';
import { useSegmentQaWorkflow } from './editor/useSegmentQaWorkflow';
import { apiClient } from '../services/apiClient';

interface UseEditorProps {
  activeFileId: number | null;
  activeTab?: 'tm' | 'concordance';
}

const VALID_SEGMENT_STATUSES: Set<SegmentStatus> = new Set([
  'new',
  'draft',
  'translated',
  'confirmed',
  'reviewed',
]);

export { createSegmentPersistor };

export function applyAISegmentTranslateResultToSegments(
  segments: Segment[],
  result: AISegmentTranslateResult,
): Segment[] {
  const propagatedIds = new Set(result.propagatedIds ?? []);
  let changed = false;

  const nextSegments = segments.map((segment): Segment => {
    if (segment.segmentId === result.segmentId) {
      changed = true;
      return {
        ...segment,
        targetTokens: result.targetTokens,
        status: result.status,
        qaIssues: result.status === 'confirmed' ? segment.qaIssues : undefined,
        autoFixSuggestions: result.status === 'confirmed' ? segment.autoFixSuggestions : undefined,
      };
    }

    if (propagatedIds.has(segment.segmentId)) {
      changed = true;
      return {
        ...segment,
        targetTokens: result.targetTokens,
        status: 'draft',
        qaIssues: undefined,
        autoFixSuggestions: undefined,
      };
    }

    return segment;
  });

  return changed ? nextSegments : segments;
}

export function useEditor({ activeFileId, activeTab = 'tm' }: UseEditorProps) {
  const [segments, setSegmentsState] = useState<Segment[]>([]);
  const [segmentChangeHint, setSegmentChangeHint] = useState<SegmentChangeHint>(() =>
    createSegmentChangeHint({ orderChanged: true }, 0),
  );
  const [segmentStats, setSegmentStats] = useState<SegmentStats>(() => buildSegmentStats([]));
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectTgtLang, setProjectTgtLang] = useState<string | null>(null);
  const [enabledQaRuleIds, setEnabledQaRuleIds] = useState<SegmentQaRuleId[]>(
    DEFAULT_PROJECT_QA_SETTINGS.enabledRuleIds,
  );
  const [fileTagPolicy, setFileTagPolicy] = useState<TagPolicy>('default');
  const [instantQaOnConfirm, setInstantQaOnConfirm] = useState<boolean>(
    DEFAULT_PROJECT_QA_SETTINGS.instantQaOnConfirm,
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [segmentSaveErrors, setSegmentSaveErrors] = useState<Record<string, string>>({});
  const [aiTranslatingSegmentIds, setAiTranslatingSegmentIds] = useState<Record<string, boolean>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const tagValidator = useMemo(() => new TagValidator(), []);

  // Keep latest values readable from stable callbacks so per-row handlers
  // (and therefore EditorRow memo bailouts) survive segment updates.
  const segmentsRef = useRef(segments);
  const segmentIndexByIdRef = useRef<Map<string, number>>(new Map());
  const segmentChangeRevisionRef = useRef(0);
  const setSegments = useCallback(
    (update: SetStateAction<Segment[]>, hint?: SegmentChangeHintInput) => {
      const currentSegments = segmentsRef.current;
      const nextSegments = resolveSegmentStateUpdate(currentSegments, update);
      if (nextSegments === currentSegments) return;
      assertSegmentChangeHintMatchesUpdate(currentSegments, nextSegments, hint);

      const orderChanged = hint?.orderChanged ?? true;
      const currentIndexById = segmentIndexByIdRef.current;

      segmentsRef.current = nextSegments;
      segmentChangeRevisionRef.current += 1;
      const nextChangeHint = createSegmentChangeHint(
        {
          orderChanged,
          changedSegmentIds: hint?.changedSegmentIds,
        },
        segmentChangeRevisionRef.current,
      );
      setSegmentChangeHint(nextChangeHint);
      setSegmentStats((previousStats) =>
        updateSegmentStats({
          previousStats,
          previousSegments: currentSegments,
          nextSegments,
          segmentIndexById: currentIndexById,
          changeHint: nextChangeHint,
        }),
      );
      if (orderChanged || segmentIndexByIdRef.current.size === 0) {
        segmentIndexByIdRef.current = createSegmentIndexById(nextSegments);
      }
      setSegmentsState(nextSegments);
    },
    [],
  );
  const getSegmentById = useCallback(
    (segmentId: string): Segment | undefined =>
      getIndexedSegment(segmentsRef.current, segmentIndexByIdRef.current, segmentId),
    [],
  );
  const getSegmentIndexById = useCallback(
    (): Map<string, number> => segmentIndexByIdRef.current,
    [],
  );
  const aiTranslatingSegmentIdsRef = useRef(aiTranslatingSegmentIds);
  useEffect(() => {
    aiTranslatingSegmentIdsRef.current = aiTranslatingSegmentIds;
  }, [aiTranslatingSegmentIds]);

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

  const normalizeStatus = useCallback((status: unknown, targetTokens: Token[]): SegmentStatus => {
    if (typeof status === 'string' && VALID_SEGMENT_STATUSES.has(status as SegmentStatus)) {
      return status as SegmentStatus;
    }
    const hasTargetContent = targetTokens.some((token) => token.content.trim().length > 0);
    return hasTargetContent ? 'draft' : 'new';
  }, []);

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
    syncStateVersion,
    clearPersistQueue,
  } = useSegmentPersistence({
    setSegments,
    setSegmentSaveError,
    clearSegmentSaveError,
  });

  const { loadEditorData } = useEditorDataLoader({
    activeFileId,
    normalizeTokens,
    normalizeStatus,
    getSegmentIndexById,
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
  });

  const activeSegmentSourceHash = useMemo(() => {
    if (!activeSegmentId) return null;
    const segment = getIndexedSegment(segments, segmentIndexByIdRef.current, activeSegmentId);
    return segment?.srcHash ?? null;
  }, [activeSegmentId, segmentChangeHint, segments]);

  const { activeMatches, activeTerms, referenceLoading } = useReferenceLookupController({
    enabled: activeTab === 'tm',
    activeSegmentId,
    activeSegmentSourceHash,
    projectId,
    segments,
  });

  const { confirmSegment: confirmSegmentWithQa } = useSegmentQaWorkflow({
    segments,
    projectId,
    targetLocale: projectTgtLang,
    enabledQaRuleIds,
    instantQaOnConfirm,
    setSegments,
    setActiveSegmentId,
    setSegmentSaveError,
    clearSegmentSaveError,
    tagValidator,
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
          const nextStatus: SegmentStatus = normalizedText.trim() ? 'draft' : 'new';
          return {
            ...segment,
            targetTokens: tokens,
            status: nextStatus,
            qaIssues: undefined,
            autoFixSuggestions: undefined,
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

  const confirmSegment = useCallback(
    async (segmentId: string) => {
      try {
        await flushSegmentDraft(segmentId);
      } catch {
        return;
      }
      await confirmSegmentWithQa(segmentId);
    },
    [confirmSegmentWithQa, flushSegmentDraft],
  );

  const handleApplyMatch = useCallback(
    (tokens: Token[]) => {
      if (!activeSegmentId) return;

      applyOptimisticSegmentUpdate(activeSegmentId, (segment) => ({
        ...segment,
        targetTokens: tokens,
        status: 'draft',
        qaIssues: undefined,
        autoFixSuggestions: undefined,
      }));
    },
    [activeSegmentId, applyOptimisticSegmentUpdate],
  );

  const handleApplyTerm = useCallback(
    (term: string) => {
      if (!activeSegmentId) return;

      applyOptimisticSegmentUpdate(activeSegmentId, (segment) => {
        const nextTokens = appendTermToTargetTokens(segment, term, fileTagPolicy);
        const nextText = normalizeEditorInputText(
          serializeTokensToEditorText(nextTokens, segment.sourceTokens),
        );
        const nextStatus: SegmentStatus = nextText.trim() ? 'draft' : 'new';

        return {
          ...segment,
          targetTokens: nextTokens,
          status: nextStatus,
          qaIssues: undefined,
          autoFixSuggestions: undefined,
        };
      });
    },
    [activeSegmentId, applyOptimisticSegmentUpdate, fileTagPolicy],
  );

  const getActiveSegment = () =>
    activeSegmentId
      ? getIndexedSegment(segments, segmentIndexByIdRef.current, activeSegmentId)
      : undefined;

  const translateSegmentWithAI = useCallback(
    async (segmentId: string) => {
      if (aiTranslatingSegmentIdsRef.current[segmentId]) {
        return;
      }

      const segment = getSegmentById(segmentId);
      if (!segment) return;

      const sourceText = serializeTokensToDisplayText(segment.sourceTokens).trim();
      if (!sourceText) {
        setSegmentSaveError(segmentId, 'AI 翻译失败：源文为空');
        return;
      }

      setAiTranslatingSegmentIds((prev) => {
        if (prev[segmentId]) return prev;
        return {
          ...prev,
          [segmentId]: true,
        };
      });
      clearSegmentSaveError(segmentId);

      try {
        const result = await apiClient.aiTranslateSegment(segmentId);
        setSegments((prev) => applyAISegmentTranslateResultToSegments(prev, result), {
          orderChanged: false,
          changedSegmentIds: [result.segmentId, ...(result.propagatedIds ?? [])],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSegmentSaveError(segmentId, `AI 翻译失败：${message}`);
      } finally {
        setAiTranslatingSegmentIds((prev) => {
          if (!prev[segmentId]) return prev;
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [clearSegmentSaveError, getSegmentById, setSegmentSaveError, setSegments],
  );

  const refineSegmentWithAI = useCallback(
    async (segmentId: string, instruction: string) => {
      if (aiTranslatingSegmentIdsRef.current[segmentId]) {
        return;
      }

      const segment = getSegmentById(segmentId);
      if (!segment) return;

      const sourceText = serializeTokensToDisplayText(segment.sourceTokens).trim();
      if (!sourceText) {
        setSegmentSaveError(segmentId, 'AI 微调失败：源文为空');
        return;
      }

      const refinementInstruction = instruction.trim();
      if (!refinementInstruction) {
        setSegmentSaveError(segmentId, 'AI 微调失败：微调指示不能为空');
        return;
      }

      setAiTranslatingSegmentIds((prev) => {
        if (prev[segmentId]) return prev;
        return {
          ...prev,
          [segmentId]: true,
        };
      });
      clearSegmentSaveError(segmentId);

      try {
        const result = await apiClient.aiRefineSegment(segmentId, refinementInstruction);
        setSegments((prev) => applyAISegmentTranslateResultToSegments(prev, result), {
          orderChanged: false,
          changedSegmentIds: [result.segmentId, ...(result.propagatedIds ?? [])],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSegmentSaveError(segmentId, `AI 微调失败：${message}`);
      } finally {
        setAiTranslatingSegmentIds((prev) => {
          if (!prev[segmentId]) return prev;
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [clearSegmentSaveError, getSegmentById, setSegmentSaveError, setSegments],
  );

  return {
    segments,
    segmentChangeHint,
    segmentIndexById: segmentIndexByIdRef.current,
    segmentStats,
    projectId,
    activeSegmentId,
    activeMatches,
    activeTerms,
    referenceLoading,
    segmentSaveErrors,
    setActiveSegmentId,
    loading,
    aiTranslatingSegmentIds,
    handleTranslationChange,
    handleSegmentEditStateChange,
    flushSegmentDraft,
    flushPendingSegmentUpdates: flushAllSegmentUpdates,
    translateSegmentWithAI,
    refineSegmentWithAI,
    confirmSegment,
    handleApplyMatch,
    handleApplyTerm,
    getActiveSegment,
    reloadEditorData: loadEditorData,
  };
}
