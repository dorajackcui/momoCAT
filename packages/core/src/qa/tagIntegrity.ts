import type { QaIssue, Segment, SegmentStatus, Token } from '../models';
import { checkTagIntegrity, collectProtectedTags } from './tagRules';

export interface TagIntegrityValidationOptions {
  status?: SegmentStatus;
  expectedTagsSignature?: string;
}

/** Compatibility adapter; the rules themselves are shared with document QA. */
export function validateTagIntegrityTokens(
  sourceTokens: Token[],
  targetTokens: Token[],
  options?: TagIntegrityValidationOptions,
): QaIssue[] {
  const sourceTags = collectProtectedTags(sourceTokens);
  const targetTags = collectProtectedTags(targetTokens);

  if (options?.status === 'empty' && targetTags.length === 0) return [];

  return checkTagIntegrity(sourceTags, targetTags, options).map((issue) => ({
    ...issue,
    // Public display compatibility only; findings never control operations.
    severity: issue.ruleId !== 'tag-order' ? 'error' : 'warning',
  }));
}

export function validateSegmentTags(segment: Segment): QaIssue[] {
  return validateTagIntegrityTokens(segment.sourceTokens, segment.targetTokens, {
    status: segment.status,
    expectedTagsSignature: segment.tagsSignature,
  });
}
