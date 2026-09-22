import type { Segment, TBMatch } from '@cat/core/models';
import type { SegmentQaRuleId } from '@cat/core/project';
import { evaluateSegmentQa, type TagValidator } from '@cat/core/qa';
import { apiClient } from '../../services/apiClient';

export interface ConfirmationQaSettings {
  projectId: number | null;
  targetLocale: string | null;
  enabledQaRuleIds: SegmentQaRuleId[];
  instantQaOnConfirm: boolean;
  tagValidator: TagValidator;
}

export async function checkSegmentConfirmation(segment: Segment, settings: ConfirmationQaSettings) {
  const { projectId, targetLocale, enabledQaRuleIds, instantQaOnConfirm, tagValidator } = settings;
  if (!instantQaOnConfirm) {
    return { qaIssues: undefined, autoFixSuggestions: undefined, blocked: false };
  }
  let termMatches: TBMatch[] = [];
  if (projectId !== null && enabledQaRuleIds.includes('terminology-consistency')) {
    try {
      termMatches = (await apiClient.getTermMatches(projectId, segment)) || [];
    } catch (error) {
      console.error('[useEditor] Failed to run TB QA check:', error);
    }
  }
  const qaIssues = evaluateSegmentQa(segment, {
    enabledRuleIds: enabledQaRuleIds,
    termMatches,
    targetLocale: targetLocale ?? undefined,
  });
  const validation = enabledQaRuleIds.includes('tag-integrity')
    ? tagValidator.validate(segment.sourceTokens, segment.targetTokens)
    : { suggestions: [] };
  return {
    qaIssues,
    autoFixSuggestions: validation.suggestions,
    blocked: qaIssues.some((issue) => issue.severity === 'error'),
  };
}
