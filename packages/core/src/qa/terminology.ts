import type { QaIssue, Segment, TBMatch } from '../models';
import { serializeTokensToSearchText } from '../text/tokenText';
import { findTermPositionsInText } from '../text/termMatching';

export interface TerminologyValidationOptions {
  targetLocale?: string;
}

export function validateSegmentTerminology(
  segment: Segment,
  termMatches: TBMatch[],
  options?: TerminologyValidationOptions,
): QaIssue[] {
  if (!Array.isArray(termMatches) || termMatches.length === 0) return [];

  const targetText = serializeTokensToSearchText(segment.targetTokens);
  if (segment.status === 'new' && !targetText.trim()) return [];

  const issues: QaIssue[] = [];
  const seen = new Set<string>();

  for (const match of termMatches) {
    const sourceTerm = match.srcTerm?.trim();
    const targetTerm = match.tgtTerm?.trim();
    if (!sourceTerm || !targetTerm) continue;

    const dedupeKey = `${
      match.srcNorm || sourceTerm.toLocaleLowerCase()
    }::${targetTerm.toLocaleLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (
      findTermPositionsInText(targetText, targetTerm, {
        locale: options?.targetLocale,
      }).length > 0
    ) {
      continue;
    }

    issues.push({
      ruleId: 'tb-term-missing',
      severity: 'warning',
      message: `Terminology check: source term "${sourceTerm}" expects "${targetTerm}" in target (TB: ${match.tbName}).`,
    });
  }

  return issues;
}
