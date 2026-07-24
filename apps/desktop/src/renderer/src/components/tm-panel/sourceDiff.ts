import type { Token } from '@cat/core/models';
import { resolveSourceRecallProfile } from '@cat/core/text';

export type SourceDiffPartKind = 'equal' | 'remove' | 'add';

export interface SourceDiffPart {
  kind: SourceDiffPartKind;
  text: string;
}

interface DiffUnit {
  key: string;
  text: string;
}

interface DiffEdit {
  kind: SourceDiffPartKind;
  unit: DiffUnit;
}

const MAX_EDIT_DISTANCE = 512;
const FALLBACK_WORD_SEGMENT_RE = /[\p{L}\p{N}]+|\s+|./gu;

function splitWhitespaceSegments(segments: string[]): string[] {
  return segments.flatMap((segment) => (/^\s+$/u.test(segment) ? Array.from(segment) : segment));
}

function segmentText(content: string, sourceLocale?: string | null): string[] {
  if (!content) return [];

  const granularity =
    resolveSourceRecallProfile(sourceLocale ?? undefined) === 'cjk' ? 'grapheme' : 'word';

  try {
    const segmenter = new Intl.Segmenter(sourceLocale || undefined, { granularity });
    return splitWhitespaceSegments(
      Array.from(segmenter.segment(content), (segment) => segment.segment),
    );
  } catch {
    return splitWhitespaceSegments(
      granularity === 'grapheme'
        ? Array.from(content)
        : Array.from(content.matchAll(FALLBACK_WORD_SEGMENT_RE), (match) => match[0]),
    );
  }
}

function atomicTokenKey(token: Token): string {
  return [
    token.type,
    token.content,
    token.meta?.id ?? '',
    token.meta?.tagType ?? '',
    token.meta?.pairedIndex ?? '',
  ].join('\u0000');
}

function buildDiffUnits(tokens: Token[], sourceLocale?: string | null): DiffUnit[] {
  return tokens.flatMap((token) => {
    if (token.type === 'tag' || token.type === 'locked') {
      return [{ key: atomicTokenKey(token), text: token.content }];
    }

    return segmentText(token.content, sourceLocale).map((text) => ({
      key: `text\u0000${text}`,
      text,
    }));
  });
}

function frontierValue(frontier: Map<number, number>, diagonal: number): number {
  return frontier.get(diagonal) ?? Number.NEGATIVE_INFINITY;
}

function backtrackDiff(
  trace: Array<Map<number, number>>,
  before: DiffUnit[],
  after: DiffUnit[],
): DiffEdit[] {
  const edits: DiffEdit[] = [];
  let beforeIndex = before.length;
  let afterIndex = after.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = beforeIndex - afterIndex;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        frontierValue(frontier, diagonal - 1) < frontierValue(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousBeforeIndex = frontier.get(previousDiagonal) ?? 0;
    const previousAfterIndex = previousBeforeIndex - previousDiagonal;

    while (beforeIndex > previousBeforeIndex && afterIndex > previousAfterIndex) {
      edits.push({ kind: 'equal', unit: before[beforeIndex - 1] });
      beforeIndex -= 1;
      afterIndex -= 1;
    }

    if (distance === 0) break;

    if (beforeIndex === previousBeforeIndex) {
      edits.push({ kind: 'add', unit: after[afterIndex - 1] });
      afterIndex -= 1;
    } else {
      edits.push({ kind: 'remove', unit: before[beforeIndex - 1] });
      beforeIndex -= 1;
    }
  }

  return edits.reverse();
}

function diffMiddle(before: DiffUnit[], after: DiffUnit[]): DiffEdit[] | null {
  const maximumDistance = before.length + after.length;
  const distanceLimit = Math.min(maximumDistance, MAX_EDIT_DISTANCE);
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= distanceLimit; distance += 1) {
    trace.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const moveDown =
        diagonal === -distance ||
        (diagonal !== distance &&
          frontierValue(frontier, diagonal - 1) < frontierValue(frontier, diagonal + 1));
      let beforeIndex = moveDown
        ? (frontier.get(diagonal + 1) ?? 0)
        : (frontier.get(diagonal - 1) ?? 0) + 1;
      let afterIndex = beforeIndex - diagonal;

      while (
        beforeIndex < before.length &&
        afterIndex < after.length &&
        before[beforeIndex].key === after[afterIndex].key
      ) {
        beforeIndex += 1;
        afterIndex += 1;
      }

      frontier.set(diagonal, beforeIndex);

      if (beforeIndex >= before.length && afterIndex >= after.length) {
        return backtrackDiff(trace, before, after);
      }
    }
  }

  return null;
}

function appendPart(parts: SourceDiffPart[], edit: DiffEdit): void {
  if (!edit.unit.text) return;

  const previous = parts[parts.length - 1];
  if (previous?.kind === edit.kind) {
    previous.text += edit.unit.text;
    return;
  }

  parts.push({ kind: edit.kind, text: edit.unit.text });
}

export function buildSourceDiff(
  tmSourceTokens: Token[],
  currentSourceTokens: Token[],
  sourceLocale?: string | null,
): SourceDiffPart[] {
  const before = buildDiffUnits(tmSourceTokens, sourceLocale);
  const after = buildDiffUnits(currentSourceTokens, sourceLocale);
  let prefixLength = 0;

  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength].key === after[prefixLength].key
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength &&
    suffixLength < after.length - prefixLength &&
    before[before.length - suffixLength - 1].key === after[after.length - suffixLength - 1].key
  ) {
    suffixLength += 1;
  }

  const beforeMiddle = before.slice(prefixLength, before.length - suffixLength);
  const afterMiddle = after.slice(prefixLength, after.length - suffixLength);
  const middleEdits = diffMiddle(beforeMiddle, afterMiddle) ?? [
    ...beforeMiddle.map((unit): DiffEdit => ({ kind: 'remove', unit })),
    ...afterMiddle.map((unit): DiffEdit => ({ kind: 'add', unit })),
  ];
  const edits: DiffEdit[] = [
    ...before.slice(0, prefixLength).map((unit): DiffEdit => ({ kind: 'equal', unit })),
    ...middleEdits,
    ...before
      .slice(before.length - suffixLength)
      .map((unit): DiffEdit => ({ kind: 'equal', unit })),
  ];
  const parts: SourceDiffPart[] = [];

  for (const edit of edits) {
    appendPart(parts, edit);
  }

  return parts;
}
