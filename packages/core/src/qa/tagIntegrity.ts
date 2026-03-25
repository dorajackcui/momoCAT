import type { QaIssue, Segment, SegmentStatus, Token } from '../models';
import { computeTagsSignature, extractTags } from '../tag/signature';

export interface TagIntegrityValidationOptions {
  status?: SegmentStatus;
  expectedTagsSignature?: string;
}

export function validateTagIntegrityTokens(
  sourceTokens: Token[],
  targetTokens: Token[],
  options?: TagIntegrityValidationOptions,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const sourceTags = extractTags(sourceTokens);
  const targetTags = extractTags(targetTokens);

  if (options?.status === 'new' && targetTags.length === 0) return [];

  const missing = sourceTags.filter((tag) => !targetTags.includes(tag));
  if (missing.length > 0) {
    issues.push({
      ruleId: 'tag-missing',
      severity: 'error',
      message: `Missing tags: ${[...new Set(missing)].join(', ')}`,
    });
  }

  const extra = targetTags.filter((tag) => !sourceTags.includes(tag));
  if (extra.length > 0) {
    issues.push({
      ruleId: 'tag-extra',
      severity: 'error',
      message: `Extra tags found: ${[...new Set(extra)].join(', ')}`,
    });
  }

  const expectedTagsSignature = options?.expectedTagsSignature ?? computeTagsSignature(sourceTokens);
  if (issues.length === 0 && expectedTagsSignature !== computeTagsSignature(targetTokens)) {
    issues.push({
      ruleId: 'tag-order',
      severity: 'warning',
      message: 'Tags are present but in a different order or count than source.',
    });
  }

  return issues;
}

export function validateSegmentTags(segment: Segment): QaIssue[] {
  return validateTagIntegrityTokens(segment.sourceTokens, segment.targetTokens, {
    status: segment.status,
    expectedTagsSignature: segment.tagsSignature,
  });
}
