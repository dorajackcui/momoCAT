import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { SegmentQaRuleId } from '@cat/core/project';
import { evaluateSegmentQa, TagValidator } from '@cat/core/qa';
import { apiClient } from '../../services/apiClient';

interface UseSegmentQaWorkflowParams {
  segments: Segment[];
  projectId: number | null;
  targetLocale: string | null;
  enabledQaRuleIds: SegmentQaRuleId[];
  instantQaOnConfirm: boolean;
  setSegments: Dispatch<SetStateAction<Segment[]>>;
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
  const confirmSegment = useCallback(
    async (segmentId: string) => {
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

        setSegments((prev) =>
          prev.map((item) => {
            if (item.segmentId !== segmentId) return item;
            return {
              ...item,
              qaIssues: combinedIssues,
              autoFixSuggestions: tagValidationResult.suggestions,
            };
          }),
        );

        if (hasBlockingErrors) {
          return;
        }
      } else {
        setSegments((prev) =>
          prev.map((item) =>
            item.segmentId === segmentId
              ? { ...item, qaIssues: undefined, autoFixSuggestions: undefined }
              : item,
          ),
        );
      }

      setSegments((prev) =>
        prev.map((item) =>
          item.segmentId === segmentId
            ? {
                ...item,
                status: 'confirmed',
              }
            : item,
        ),
      );
      clearSegmentSaveError(segmentId);

      try {
        await apiClient.updateSegment(segmentId, segment.targetTokens, 'confirmed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSegments((prev) =>
          prev.map((item) =>
            item.segmentId === segmentId
              ? {
                  ...item,
                  status: previousStatus,
                }
              : item,
          ),
        );
        setSegmentSaveError(segmentId, `保存失败：${message}`);
        return;
      }

      const currentIndex = segments.findIndex((item) => item.segmentId === segmentId);
      if (currentIndex < segments.length - 1) {
        setActiveSegmentId(segments[currentIndex + 1].segmentId);
      }
    },
    [
      enabledQaRuleIds,
      instantQaOnConfirm,
      projectId,
      targetLocale,
      segments,
      clearSegmentSaveError,
      setActiveSegmentId,
      setSegmentSaveError,
      setSegments,
      tagValidator,
    ],
  );

  return {
    confirmSegment,
  };
}
