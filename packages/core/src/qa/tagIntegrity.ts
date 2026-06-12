import type { QaIssue, Segment, SegmentStatus, Token } from '../models';
import { computeTagsSignature, extractTags } from '../tag/signature';

export interface TagIntegrityValidationOptions {
  status?: SegmentStatus;
  expectedTagsSignature?: string;
}

function countTags(tags: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  tags.forEach((tag) => {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  });
  return counts;
}

function getCountDelta(base: Map<string, number>, comparison: Map<string, number>): string[] {
  const delta: string[] = [];
  base.forEach((count, tag) => {
    const missingCount = count - (comparison.get(tag) ?? 0);
    for (let index = 0; index < missingCount; index += 1) {
      delta.push(tag);
    }
  });
  return delta;
}

function formatTagForMessage(tag: string): string {
  if (tag === '\r' || tag === '\\r') return '\\r';
  if (tag === '\n' || tag === '\\n') return '\\n';
  return tag;
}

function formatUniqueTags(tags: string[]): string {
  return [...new Set(tags)].map(formatTagForMessage).join(', ');
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

  const sourceTagCounts = countTags(sourceTags);
  const targetTagCounts = countTags(targetTags);

  const missing = getCountDelta(sourceTagCounts, targetTagCounts);
  if (missing.length > 0) {
    issues.push({
      ruleId: 'tag-missing',
      severity: 'error',
      message: `Missing tags: ${formatUniqueTags(missing)}`,
    });
  }

  const extra = getCountDelta(targetTagCounts, sourceTagCounts);
  if (extra.length > 0) {
    issues.push({
      ruleId: 'tag-extra',
      severity: 'error',
      message: `Extra tags found: ${formatUniqueTags(extra)}`,
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
