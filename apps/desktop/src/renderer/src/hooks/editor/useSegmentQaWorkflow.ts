import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { SegmentQaRuleId } from '@cat/core/project';
import { evaluateSegmentQa, TagValidator } from '@cat/core/qa';
import { apiClient } from '../../services/apiClient';
import type { SetSegmentsWithChangeHint } from './editorSegmentState';

interface UseSegmentQaWorkflowParams {
  segments: Segment[];
  projectId: number | null;
  targetLocale: string | null;
  enabledQaRuleIds: SegmentQaRuleId[];
  instantQaOnConfirm: boolean;
  setSegments: SetSegmentsWithChangeHint;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  setSegmentSaveError: (segmentId: string, message: string) => void;
  clearSegmentSaveError: (segmentId: string) => void;
  tagValidator: TagValidator;
}

export function useSegmentQaWorkflow({
  segments,
  projectId,
  targetLocale,
  enabledQaRuleIds,
  instantQaOnConfirm,
  setSegments,
  setActiveSegmentId,
  setSegmentSaveError,
  clearSegmentSaveError,
  tagValidator,
}: UseSegmentQaWorkflowParams): { confirmSegment: (segmentId: string) => Promise<void> } {
  // Read frequently-changing inputs through a ref so confirmSegment keeps a
  // stable identity (it is forwarded to every EditorRow as onConfirm).
  const workflowInputsRef = useRef({
    segments,
    projectId,
    targetLocale,
    enabledQaRuleIds,
    instantQaOnConfirm,
    tagValidator,
  });
  useLayoutEffect(() => {
    workflowInputsRef.current = {
      segments,
      projectId,
      targetLocale,
      enabledQaRuleIds,
      instantQaOnConfirm,
      tagValidator,
    };
  }, [segments, projectId, targetLocale, enabledQaRuleIds, instantQaOnConfirm, tagValidator]);

  const confirmSegment = useCallback(
    async (segmentId: string) => {
      const { segments, projectId, targetLocale, enabledQaRuleIds, instantQaOnConfirm, tagValidator } =
        workflowInputsRef.current;
      const segment = segments.find((item) => item.segmentId === segmentId);
      if (!segment) return;
      const previousStatus = segment.status;

      if (instantQaOnConfirm) {
        let termMatches: TBMatch[] = [];
        if (projectId !== null && enabledQaRuleIds.includes('terminology-consistency')) {
          try {
            termMatches = (await apiClient.getTermMatches(projectId, segment)) || [];
          } catch (error) {
            console.error('[useEditor] Failed to run TB QA check:', error);
          }
        }

        const combinedIssues = evaluateSegmentQa(segment, {
          enabledRuleIds: enabledQaRuleIds,
          termMatches,
          targetLocale: targetLocale ?? undefined,
        });
        const hasBlockingErrors = combinedIssues.some((issue) => issue.severity === 'error');
        const tagValidationResult = enabledQaRuleIds.includes('tag-integrity')
          ? tagValidator.validate(segment.sourceTokens, segment.targetTokens)
          : { issues: [], suggestions: [] };

        setSegments(
          (prev) =>
            prev.map((item) => {
              if (item.segmentId !== segmentId) return item;
              return {
                ...item,
                qaIssues: combinedIssues,
                autoFixSuggestions: tagValidationResult.suggestions,
              };
            }),
          { orderChanged: false, changedSegmentIds: [segmentId] },
        );

        if (hasBlockingErrors) {
          return;
        }
      } else {
        setSegments(
          (prev) =>
            prev.map((item) =>
              item.segmentId === segmentId
                ? { ...item, qaIssues: undefined, autoFixSuggestions: undefined }
                : item,
            ),
          { orderChanged: false, changedSegmentIds: [segmentId] },
        );
      }

      setSegments(
        (prev) =>
          prev.map((item) =>
            item.segmentId === segmentId
              ? {
                  ...item,
                  status: 'confirmed',
                }
              : item,
          ),
        { orderChanged: false, changedSegmentIds: [segmentId] },
      );
      clearSegmentSaveError(segmentId);

      try {
        await apiClient.updateSegment(segmentId, segment.targetTokens, 'confirmed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSegments(
          (prev) =>
            prev.map((item) =>
              item.segmentId === segmentId
                ? {
                    ...item,
                    status: previousStatus,
                  }
                : item,
            ),
          { orderChanged: false, changedSegmentIds: [segmentId] },
        );
        setSegmentSaveError(segmentId, `保存失败：${message}`);
        return;
      }

      const currentIndex = segments.findIndex((item) => item.segmentId === segmentId);
      if (currentIndex < segments.length - 1) {
        setActiveSegmentId(segments[currentIndex + 1].segmentId);
      }
    },
    [clearSegmentSaveError, setActiveSegmentId, setSegmentSaveError, setSegments],
  );

  return {
    confirmSegment,
  };
}
