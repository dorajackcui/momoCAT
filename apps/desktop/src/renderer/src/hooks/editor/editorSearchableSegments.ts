import type { Segment } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { SearchableEditorSegment } from '../../components/editorFilterUtils';

function normalizeEditorText(
  tokens: Segment['sourceTokens'],
  sourceTokens: Segment['sourceTokens'],
): string {
  return serializeTokensToEditorText(tokens, sourceTokens)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function buildSearchableEditorSegments(
  segments: Segment[],
  segmentSaveErrors: Record<string, string>,
): SearchableEditorSegment[] {
  return segments.map((segment, index) => {
    const sourceText = normalizeEditorText(segment.sourceTokens, segment.sourceTokens);
    const targetText = normalizeEditorText(segment.targetTokens, segment.sourceTokens);
    const qaIssues = segment.qaIssues || [];
    const hasQaError = qaIssues.some((issue) => issue.severity === 'error');
    const hasQaWarning = qaIssues.some((issue) => issue.severity === 'warning');
    const hasSaveError = Boolean(segmentSaveErrors[segment.segmentId]);
    const isUntranslated = targetText.trim().length === 0;

    return {
      segment,
      originalIndex: index,
      sourceText,
      targetText,
      hasQaError,
      hasQaWarning,
      hasSaveError,
      isUntranslated,
      hasIssue: hasQaError || hasQaWarning || hasSaveError,
    };
  });
}

export function buildSearchableEditorSegmentsWithWeakCache(params: {
  segments: Segment[];
  segmentSaveErrors: Record<string, string>;
  cache: WeakMap<Segment, SearchableEditorSegment>;
}): SearchableEditorSegment[] {
  const { segments, segmentSaveErrors, cache } = params;
  return segments.map((segment, index) => {
    const cached = cache.get(segment);
    const hasSaveError = Boolean(segmentSaveErrors[segment.segmentId]);
    if (cached && cached.originalIndex === index && cached.hasSaveError === hasSaveError) {
      return cached;
    }

    if (cached) {
      const nextCached: SearchableEditorSegment = {
        ...cached,
        originalIndex: index,
        hasSaveError,
        hasIssue: cached.hasQaError || cached.hasQaWarning || hasSaveError,
      };
      cache.set(segment, nextCached);
      return nextCached;
    }

    const sourceText = normalizeEditorText(segment.sourceTokens, segment.sourceTokens);
    const targetText = normalizeEditorText(segment.targetTokens, segment.sourceTokens);
    const qaIssues = segment.qaIssues || [];
    const hasQaError = qaIssues.some((issue) => issue.severity === 'error');
    const hasQaWarning = qaIssues.some((issue) => issue.severity === 'warning');
    const isUntranslated = targetText.trim().length === 0;
    const nextSearchable: SearchableEditorSegment = {
      segment,
      originalIndex: index,
      sourceText,
      targetText,
      hasQaError,
      hasQaWarning,
      hasSaveError,
      isUntranslated,
      hasIssue: hasQaError || hasQaWarning || hasSaveError,
    };
    cache.set(segment, nextSearchable);
    return nextSearchable;
  });
}

export function resolveActiveSegmentIdForFilteredList(params: {
  activeSegmentId: string | null;
  segments: Segment[];
  filteredSegments: SearchableEditorSegment[];
}): string | null {
  const { activeSegmentId, segments, filteredSegments } = params;
  if (filteredSegments.length === 0) return null;

  const fallbackId = filteredSegments[0].segment.segmentId;
  if (!activeSegmentId) return fallbackId;

  const activeStillExists = segments.some((segment) => segment.segmentId === activeSegmentId);
  if (!activeStillExists) return fallbackId;

  return activeSegmentId;
}
