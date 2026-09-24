import type { QaIssue, Segment, TBMatch } from '../models';
import { normalizeQASettings, type ProjectQASettings, type SegmentQaRuleId } from '../project';
import { evaluateDocumentQa } from './documentQa';

export interface EvaluateSegmentQaOptions {
  termMatches?: TBMatch[];
  enabledRuleIds?: SegmentQaRuleId[];
  targetLocale?: string;
  settings?: ProjectQASettings;
  tagPolicy?: 'default' | 'none';
}

export function evaluateSegmentQa(segment: Segment, options?: EvaluateSegmentQaOptions): QaIssue[] {
  const settings = normalizeQASettings(
    options?.settings ??
      (options?.enabledRuleIds ? { enabledRuleIds: options.enabledRuleIds } : undefined),
  );
  // A single sentence cannot establish a document-level terminology baseline.
  settings.options = { ...settings.options, termMarks: [] };
  return evaluateDocumentQa([segment], {
    settings,
    targetLocale: options?.targetLocale,
    tagPolicy: options?.tagPolicy,
    termMatches: new Map([[segment.segmentId, options?.termMatches ?? []]]),
  }).issues;
}
