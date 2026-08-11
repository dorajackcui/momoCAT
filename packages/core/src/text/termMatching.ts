import {
  CJK_LIKE_RE,
  LETTER_OR_NUMBER_RE,
  normalizeTextWithIndexMap,
  resolveTermLocale,
} from './termNormalization';

export { normalizeTermForLookup } from './termNormalization';
export type { TermNormalizationOptions } from './termNormalization';
export { buildTermSearchFragments, buildTermSearchPlan } from './termSearchPlanning';
export type { TermSearchFragmentOptions, TermSearchPlan } from './termSearchPlanning';

export interface TermMatchPosition {
  start: number;
  end: number;
}

export interface TermSearchOptions {
  locale?: string;
}

function getRawCharLength(value: string, start: number): number {
  const codePoint = value.codePointAt(start);
  if (codePoint === undefined) return 0;
  return codePoint > 0xffff ? 2 : 1;
}

function getSegmenter(locale?: string): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter === 'undefined') {
    return null;
  }

  return new Intl.Segmenter(locale, { granularity: 'word' });
}

function buildBoundarySet(text: string, locale?: string): Set<number> {
  const boundaries = new Set<number>([0, text.length]);
  const segmenter = getSegmenter(locale);

  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      boundaries.add(segment.index);
      boundaries.add(segment.index + segment.segment.length);
    }
    return boundaries;
  }

  for (let index = 1; index < text.length; index += 1) {
    const previous = text[index - 1];
    const current = text[index];
    const previousIsWord = LETTER_OR_NUMBER_RE.test(previous);
    const currentIsWord = LETTER_OR_NUMBER_RE.test(current);
    if (previousIsWord !== currentIsWord) {
      boundaries.add(index);
    }
  }

  return boundaries;
}

function shouldRequireBoundaries(term: string): boolean {
  if (!LETTER_OR_NUMBER_RE.test(term)) return false;
  return !CJK_LIKE_RE.test(term);
}

export function findTermPositionsInText(
  text: string,
  term: string,
  options?: TermSearchOptions,
): TermMatchPosition[] {
  const locale = resolveTermLocale(term, options?.locale);
  const normalizedSource = normalizeTextWithIndexMap(text, locale);
  const normalizedTerm = normalizeTextWithIndexMap(term, locale).text;

  if (!normalizedSource.text || !normalizedTerm) return [];

  const requireBoundaries = shouldRequireBoundaries(normalizedTerm);
  const boundaries = requireBoundaries ? buildBoundarySet(normalizedSource.text, locale) : null;

  const positions: TermMatchPosition[] = [];
  let from = 0;

  while (from < normalizedSource.text.length) {
    const index = normalizedSource.text.indexOf(normalizedTerm, from);
    if (index < 0) break;

    const end = index + normalizedTerm.length;
    const boundaryMatch =
      !requireBoundaries || (boundaries?.has(index) && boundaries?.has(end));

    if (boundaryMatch) {
      const rawStart = normalizedSource.indexMap[index];
      const rawEndIndex = normalizedSource.indexMap[end - 1];
      positions.push({
        start: rawStart,
        end: rawEndIndex + getRawCharLength(text, rawEndIndex),
      });
    }

    from = index + Math.max(normalizedTerm.length, 1);
  }

  return positions;
}

function isStrictlyContainedPosition(
  inner: TermMatchPosition,
  outer: TermMatchPosition,
): boolean {
  const innerLength = inner.end - inner.start;
  const outerLength = outer.end - outer.start;

  return outer.start <= inner.start && outer.end >= inner.end && outerLength > innerLength;
}

export function suppressNestedTermMatches<T extends { positions: TermMatchPosition[] }>(
  matches: T[],
): T[] {
  const occupiedRanges: TermMatchPosition[] = [];
  const selected: T[] = [];

  for (const match of matches) {
    const visiblePositions = match.positions.filter(
      (position) => !occupiedRanges.some((range) => isStrictlyContainedPosition(position, range)),
    );

    if (visiblePositions.length === 0) continue;

    occupiedRanges.push(...visiblePositions);
    selected.push({
      ...match,
      positions: visiblePositions,
    } as T);
  }

  return selected;
}
