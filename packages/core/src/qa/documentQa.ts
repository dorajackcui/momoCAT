import type { QaIssue, Segment, TBMatch } from '../models';
import {
  isQaCheckEnabled,
  normalizeQASettings,
  type ProjectQASettings,
  type FileQaReport,
} from '../project';
import { checkConsistency, checkSubstrings, prepareQaRows } from './documentConsistency';
import { checkDocumentTags } from './documentTags';
import { checkProtectedTokens } from './protectedTokens';
import { checkDocumentTerminology } from './documentTerminology';
import { checkTextRules } from './targetText';
import { qaRow, qaText } from './text';

export interface DocumentQaOptions {
  settings?: ProjectQASettings;
  termMatches?: ReadonlyMap<string, TBMatch[]>;
  sourceLocale?: string;
  targetLocale?: string;
  tagPolicy?: 'default' | 'none';
}

export function evaluateDocumentQa(
  segments: readonly Segment[],
  options: DocumentQaOptions = {},
): FileQaReport {
  const settings = normalizeQASettings(options.settings);
  const findings = new Map<string, QaIssue[]>();
  const add = (segment: Segment, issue: QaIssue) => {
    const list = findings.get(segment.segmentId) ?? [];
    list.push(issue);
    findings.set(segment.segmentId, list);
  };
  for (const segment of segments) {
    for (const issue of checkTextRules(
      qaText(segment.sourceTokens),
      qaText(segment.targetTokens),
      (ruleId) => isQaCheckEnabled(settings, ruleId),
    ))
      add(segment, issue);
    for (const issue of checkProtectedTokens(
      segment.sourceTokens,
      segment.targetTokens,
      options.tagPolicy,
    ))
      add(segment, issue);
    if (settings.enabledRuleIds.includes('tag-integrity') && options.tagPolicy === 'none') {
      for (const issue of checkDocumentTags(segment, settings)) {
        if (isQaCheckEnabled(settings, issue.ruleId)) add(segment, issue);
      }
    }
  }
  // Cross-row rules are document scoped, never scoped to a UI filter or a DB page.
  const files = new Map<number, Segment[]>();
  for (const segment of segments) {
    const file = files.get(segment.fileId) ?? [];
    file.push(segment);
    files.set(segment.fileId, file);
  }
  for (const file of files.values()) {
    const terminology = settings.enabledRuleIds.includes('terminology-consistency')
      ? checkDocumentTerminology(
          file,
          options.termMatches ?? new Map(),
          settings,
          options.sourceLocale,
          options.targetLocale,
        )
      : { issues: new Map<string, QaIssue[]>(), sourceTerms: new Set<string>() };
    for (const segment of file)
      for (const issue of terminology.issues.get(segment.segmentId) ?? []) add(segment, issue);
    if (
      !['source-consistency', 'target-consistency', 'substring-consistency'].some((ruleId) =>
        isQaCheckEnabled(settings, ruleId),
      )
    )
      continue;
    const rows = prepareQaRows(file);
    if (isQaCheckEnabled(settings, 'source-consistency')) checkConsistency(rows, false, add);
    if (isQaCheckEnabled(settings, 'target-consistency')) checkConsistency(rows, true, add);
    if (isQaCheckEnabled(settings, 'substring-consistency'))
      checkSubstrings(rows, settings, terminology.sourceTerms, add);
  }
  const issues = segments.flatMap((segment) =>
    (findings.get(segment.segmentId) ?? []).map((issue) => ({
      ...issue,
      segmentId: segment.segmentId,
      row: qaRow(segment),
    })),
  );
  return {
    fileId: segments[0]?.fileId ?? 0,
    checkedSegments: segments.length,
    issues,
    issueCount: issues.length,
    affectedSegments: findings.size,
    errorCount: 0,
    warningCount: 0,
  };
}
