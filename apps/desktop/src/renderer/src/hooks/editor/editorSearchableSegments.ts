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
    return buildSearchableEditorSegment(segment, index, segmentSaveErrors);
  });
}

function buildSearchableEditorSegment(
  segment: Segment,
  index: number,
  segmentSaveErrors: Record<string, string>,
): SearchableEditorSegment {
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

    const nextSearchable = buildSearchableEditorSegment(segment, index, segmentSaveErrors);
    cache.set(segment, nextSearchable);
    return nextSearchable;
  });
}

export function buildSearchableEditorSegmentsIncrementally(params: {
  segments: Segment[];
  segmentSaveErrors: Record<string, string>;
  cache: WeakMap<Segment, SearchableEditorSegment>;
  previous: SearchableEditorSegment[] | null;
  changedSegmentIds?: ReadonlySet<string>;
  segmentIndexById?: ReadonlyMap<string, number>;
  orderChanged?: boolean;
}): SearchableEditorSegment[] {
  const {
    segments,
    segmentSaveErrors,
    cache,
    previous,
    changedSegmentIds,
    segmentIndexById,
    orderChanged = true,
  } = params;

  if (
    !previous ||
    orderChanged ||
    !changedSegmentIds ||
    !segmentIndexById ||
    previous.length !== segments.length
  ) {
    return buildSearchableEditorSegmentsWithWeakCache({ segments, segmentSaveErrors, cache });
  }

  if (changedSegmentIds.size === 0) {
    return previous;
  }

  let next: SearchableEditorSegment[] | null = null;

  for (const segmentId of changedSegmentIds) {
    const index = segmentIndexById.get(segmentId);
    if (index === undefined || index < 0 || index >= segments.length) {
      return buildSearchableEditorSegmentsWithWeakCache({ segments, segmentSaveErrors, cache });
    }

    const segment = segments[index];
    if (!segment || segment.segmentId !== segmentId) {
      return buildSearchableEditorSegmentsWithWeakCache({ segments, segmentSaveErrors, cache });
    }

    const cached = cache.get(segment);
    const hasSaveError = Boolean(segmentSaveErrors[segment.segmentId]);
    const nextSearchable =
      cached && cached.originalIndex === index && cached.hasSaveError === hasSaveError
        ? cached
        : buildSearchableEditorSegment(segment, index, segmentSaveErrors);

    if (nextSearchable !== previous[index]) {
      if (next === null) {
        next = previous.slice();
      }
      next[index] = nextSearchable;
    }
    cache.set(segment, nextSearchable);
  }

  return next ?? previous;
}

export function resolveActiveSegmentIdForFilteredList(params: {
  activeSegmentId: string | null;
  segments: Segment[];
  filteredSegments: SearchableEditorSegment[];
  segmentIndexById?: ReadonlyMap<string, number>;
}): string | null {
  const { activeSegmentId, segments, filteredSegments, segmentIndexById } = params;
  if (filteredSegments.length === 0) return null;

  const fallbackId = filteredSegments[0].segment.segmentId;
  if (!activeSegmentId) return fallbackId;

  const indexedActiveSegment =
    segmentIndexById === undefined ? undefined : segmentIndexById.get(activeSegmentId);
  const activeStillExists =
    indexedActiveSegment !== undefined
      ? segments[indexedActiveSegment]?.segmentId === activeSegmentId
      : segments.some((segment) => segment.segmentId === activeSegmentId);
  if (!activeStillExists) return fallbackId;

  return activeSegmentId;
}

export function resolveActiveFilteredSegmentIndex(params: {
  activeSegmentId: string | null;
  filteredSegments: SearchableEditorSegment[];
  segmentIndexById?: ReadonlyMap<string, number>;
  canUseSegmentIndex: boolean;
}): number {
  const { activeSegmentId, filteredSegments, segmentIndexById, canUseSegmentIndex } = params;
  if (!activeSegmentId) return -1;

  if (canUseSegmentIndex && segmentIndexById) {
    const indexed = segmentIndexById.get(activeSegmentId);
    if (
      indexed !== undefined &&
      filteredSegments[indexed]?.segment.segmentId === activeSegmentId
    ) {
      return indexed;
    }
  }

  return filteredSegments.findIndex((item) => item.segment.segmentId === activeSegmentId);
}
