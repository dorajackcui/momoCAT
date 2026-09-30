import type { Segment } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import {
  type RepeatedSourceRole,
  SearchableEditorSegment,
} from '../../components/editorFilterUtils';

function normalizeEditorText(
  tokens: Segment['sourceTokens'],
  sourceTokens: Segment['sourceTokens'],
): string {
  return serializeTokensToEditorText(tokens, sourceTokens)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function buildSearchableEditorSegments(
  segments: readonly Segment[],
  segmentSaveErrors: Record<string, string>,
): SearchableEditorSegment[] {
  const repeatedSourceHashes = collectRepeatedSourceHashes(segments);
  const seenRepeatedSourceHashes = new Set<string>();
  return segments.map((segment, index) => {
    const repeatedSourceRole = resolveRepeatedSourceRole(
      segment.srcHash,
      repeatedSourceHashes,
      seenRepeatedSourceHashes,
    );
    return buildSearchableEditorSegment(segment, index, segmentSaveErrors, repeatedSourceRole);
  });
}

function collectRepeatedSourceHashes(segments: readonly Segment[]): Set<string> {
  const seenSourceHashes = new Set<string>();
  const repeatedSourceHashes = new Set<string>();
  for (const segment of segments) {
    if (!segment.srcHash) continue;
    if (seenSourceHashes.has(segment.srcHash)) {
      repeatedSourceHashes.add(segment.srcHash);
    } else {
      seenSourceHashes.add(segment.srcHash);
    }
  }
  return repeatedSourceHashes;
}

function resolveRepeatedSourceRole(
  srcHash: string,
  repeatedSourceHashes: ReadonlySet<string>,
  seenRepeatedSourceHashes: Set<string>,
): RepeatedSourceRole | undefined {
  if (!srcHash || !repeatedSourceHashes.has(srcHash)) return undefined;
  if (seenRepeatedSourceHashes.has(srcHash)) return 'later';
  seenRepeatedSourceHashes.add(srcHash);
  return 'first';
}

function buildSearchableEditorSegment(
  segment: Segment,
  index: number,
  segmentSaveErrors: Record<string, string>,
  repeatedSourceRole?: RepeatedSourceRole,
): SearchableEditorSegment {
  const sourceText = normalizeEditorText(segment.sourceTokens, segment.sourceTokens);
  const targetText = normalizeEditorText(segment.targetTokens, segment.sourceTokens);
  const qaIssues = segment.qaIssues || [];

  const hasSaveError = Boolean(segmentSaveErrors[segment.segmentId]);

  return {
    segment,
    originalIndex: index,
    sourceText,
    targetText,

    hasQaIssue: qaIssues.length > 0,
    hasSaveError,
    repeatedSourceRole,
  };
}

export function buildSearchableEditorSegmentsWithWeakCache(params: {
  segments: readonly Segment[];
  segmentSaveErrors: Record<string, string>;
  cache: WeakMap<Segment, SearchableEditorSegment>;
}): SearchableEditorSegment[] {
  const { segments, segmentSaveErrors, cache } = params;
  const repeatedSourceHashes = collectRepeatedSourceHashes(segments);
  const seenRepeatedSourceHashes = new Set<string>();
  return segments.map((segment, index) => {
    const cached = cache.get(segment);
    const hasSaveError = Boolean(segmentSaveErrors[segment.segmentId]);
    const repeatedSourceRole = resolveRepeatedSourceRole(
      segment.srcHash,
      repeatedSourceHashes,
      seenRepeatedSourceHashes,
    );
    if (
      cached &&
      cached.originalIndex === index &&
      cached.hasSaveError === hasSaveError &&
      cached.repeatedSourceRole === repeatedSourceRole
    ) {
      return cached;
    }

    if (cached) {
      const nextCached: SearchableEditorSegment = {
        ...cached,
        originalIndex: index,
        hasSaveError,
        repeatedSourceRole,
      };
      cache.set(segment, nextCached);
      return nextCached;
    }

    const nextSearchable = buildSearchableEditorSegment(
      segment,
      index,
      segmentSaveErrors,
      repeatedSourceRole,
    );
    cache.set(segment, nextSearchable);
    return nextSearchable;
  });
}
