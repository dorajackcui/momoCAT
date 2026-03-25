import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PROJECT_QA_SETTINGS, type SegmentQaRuleId } from '@cat/core/project';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { useActiveSegmentMatches } from './editor/useActiveSegmentMatches';
import { createSegmentPersistor, useSegmentPersistence } from './editor/useSegmentPersistence';
import { useEditorDataLoader } from './editor/useEditorDataLoader';
import { useSegmentQaWorkflow } from './editor/useSegmentQaWorkflow';
import { apiClient } from '../services/apiClient';

interface UseEditorProps {
  activeFileId: number | null;
}

const VALID_SEGMENT_STATUSES: Set<SegmentStatus> = new Set([
  'new',
  'draft',
  'translated',
  'confirmed',
  'reviewed',
]);

export { createSegmentPersistor };

export function useEditor({ activeFileId }: UseEditorProps) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectTgtLang, setProjectTgtLang] = useState<string | null>(null);
  const [enabledQaRuleIds, setEnabledQaRuleIds] = useState<SegmentQaRuleId[]>(
    DEFAULT_PROJECT_QA_SETTINGS.enabledRuleIds,
  );
  const [instantQaOnConfirm, setInstantQaOnConfirm] = useState<boolean>(
    DEFAULT_PROJECT_QA_SETTINGS.instantQaOnConfirm,
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [segmentSaveErrors, setSegmentSaveErrors] = useState<Record<string, string>>({});
  const [aiTranslatingSegmentIds, setAiTranslatingSegmentIds] = useState<Record<string, boolean>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const tagValidator = new TagValidator();

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
    setSegments,
    setProjectId,
    setProjectTgtLang,
    setEnabledQaRuleIds,
    setInstantQaOnConfirm,
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
    const segment = segments.find((item) => item.segmentId === activeSegmentId);
    return segment?.srcHash ?? null;
  }, [activeSegmentId, segments]);

  const { activeMatches, activeTerms } = useActiveSegmentMatches({
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
      void flushAllSegmentUpdates();
    },
    [flushAllSegmentUpdates],
  );

  useEffect(() => {
    const flushPendingChanges = () => {
      void flushAllSegmentUpdates();
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
          const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const tokens = parseEditorTextToTokens(normalizedText, segment.sourceTokens);
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
    [applyOptimisticSegmentUpdate],
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
      await flushSegmentDraft(segmentId);
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

  const shouldInsertSpace = useCallback((current: string, term: string): boolean => {
    const left = current.slice(-1);
    const right = term.slice(0, 1);
    if (!left || !right) return false;
    return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  }, []);

  const handleApplyTerm = useCallback(
    (term: string) => {
      if (!activeSegmentId) return;

      applyOptimisticSegmentUpdate(activeSegmentId, (segment) => {
        const currentText = serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens)
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');
        const spacer = shouldInsertSpace(currentText, term) ? ' ' : '';
        const nextText = `${currentText}${spacer}${term}`;
        const nextTokens = parseEditorTextToTokens(nextText, segment.sourceTokens);
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
    [activeSegmentId, applyOptimisticSegmentUpdate, shouldInsertSpace],
  );

  const getActiveSegment = () => segments.find((segment) => segment.segmentId === activeSegmentId);

  const translateSegmentWithAI = useCallback(
    async (segmentId: string) => {
      if (aiTranslatingSegmentIds[segmentId]) {
        return;
      }

      const segment = segments.find((item) => item.segmentId === segmentId);
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
        await apiClient.aiTranslateSegment(segmentId);
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
    [aiTranslatingSegmentIds, clearSegmentSaveError, segments, setSegmentSaveError],
  );

  const refineSegmentWithAI = useCallback(
    async (segmentId: string, instruction: string) => {
      if (aiTranslatingSegmentIds[segmentId]) {
        return;
      }

      const segment = segments.find((item) => item.segmentId === segmentId);
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
        await apiClient.aiRefineSegment(segmentId, refinementInstruction);
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
    [aiTranslatingSegmentIds, clearSegmentSaveError, segments, setSegmentSaveError],
  );

  return {
    segments,
    projectId,
    activeSegmentId,
    activeMatches,
    activeTerms,
    segmentSaveErrors,
    setActiveSegmentId,
    loading,
    aiTranslatingSegmentIds,
    handleTranslationChange,
    handleSegmentEditStateChange,
    flushSegmentDraft,
    translateSegmentWithAI,
    refineSegmentWithAI,
    confirmSegment,
    handleApplyMatch,
    handleApplyTerm,
    getActiveSegment,
    reloadEditorData: loadEditorData,
  };
}
