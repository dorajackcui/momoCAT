import type { QaIssue, Segment, TBMatch } from '../models';
import { DEFAULT_PROJECT_QA_SETTINGS, type SegmentQaRuleId } from '../project';
import { validateSegmentTags } from './tagIntegrity';
import { validateSegmentTerminology } from './terminology';

export interface EvaluateSegmentQaOptions {
  termMatches?: TBMatch[];
  enabledRuleIds?: SegmentQaRuleId[];
  targetLocale?: string;
}

export function evaluateSegmentQa(
  segment: Segment,
  options?: EvaluateSegmentQaOptions,
): QaIssue[] {
  const enabledRuleIds = options?.enabledRuleIds ?? DEFAULT_PROJECT_QA_SETTINGS.enabledRuleIds;
  const issues: QaIssue[] = [];

  if (enabledRuleIds.includes('tag-integrity')) {
    issues.push(...validateSegmentTags(segment));
  }

  if (enabledRuleIds.includes('terminology-consistency')) {
    issues.push(
      ...validateSegmentTerminology(segment, options?.termMatches || [], {
        targetLocale: options?.targetLocale,
      }),
    );
  }

  return issues;
}
