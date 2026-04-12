export interface TermMatchPosition {
  start: number;
  end: number;
}

export interface TermSearchOptions {
  locale?: string;
}

export interface TermNormalizationOptions {
  locale?: string;
}

export interface TermSearchFragmentOptions extends TermNormalizationOptions {
  maxFragments?: number;
}

export interface TermSearchPlan {
  ftsFragments: string[];
  exactLookupTerms: string[];
}

const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const CJK_LIKE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DEFAULT_MAX_FRAGMENTS = 24;
const CJK_EXACT_TERM_SIZES = [4, 3, 2, 1];

function normalizeTextWithIndexMap(
  value: string,
  locale?: string,
): { text: string; indexMap: number[] } {
  let normalized = '';
  const indexMap: number[] = [];
  let lastWasSpace = true;

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;

    const rawChar = String.fromCodePoint(codePoint);
    const normalizedChunk = locale
      ? rawChar.normalize('NFKC').toLocaleLowerCase(locale)
      : rawChar.normalize('NFKC').toLocaleLowerCase();

    for (const chunkChar of normalizedChunk) {
      const outputChar = /\s/u.test(chunkChar) ? ' ' : chunkChar;
      if (outputChar === ' ') {
        if (lastWasSpace) continue;
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }

      normalized += outputChar;
      indexMap.push(index);
    }

    index += rawChar.length;
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    indexMap.pop();
  }

  return {
    text: normalized,
    indexMap,
  };
}

function getRawCharLength(value: string, start: number): number {
  const codePoint = value.codePointAt(start);
  if (codePoint === undefined) return 0;
  return codePoint > 0xffff ? 2 : 1;
}

function inferLocaleFromTerm(value: string): string | undefined {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'ja-JP';
  if (/[\p{Script=Hangul}]/u.test(value)) return 'ko-KR';
  if (/[\p{Script=Han}]/u.test(value)) return 'zh-CN';
  return undefined;
}

function resolveLocale(value: string, locale?: string): string | undefined {
  return locale || inferLocaleFromTerm(value);
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

function sanitizeSearchText(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function splitMixedScriptToken(value: string): string[] {
  if (!value) return [];

  const tokens: string[] = [];
  let current = '';
  let currentIsCjk: boolean | null = null;

  for (const char of value) {
    const isWordChar = LETTER_OR_NUMBER_RE.test(char);
    if (!isWordChar) {
      if (current) tokens.push(current);
      current = '';
      currentIsCjk = null;
      continue;
    }

    const isCjk = CJK_LIKE_RE.test(char);
    if (current && currentIsCjk !== isCjk) {
      tokens.push(current);
      current = char;
      currentIsCjk = isCjk;
      continue;
    }

    current += char;
    currentIsCjk = isCjk;
  }

  if (current) tokens.push(current);
  return tokens;
}

function addFragment(target: Set<string>, value: string) {
  const fragment = value.trim();
  if (fragment.length < 2) return;
  target.add(fragment);
}

function addWindowFragments(target: Set<string>, value: string, windowSize: number) {
  if (value.length <= windowSize) {
    addFragment(target, value);
    return;
  }

  const maxStart = value.length - windowSize;
  const starts = new Set([0, 1, Math.floor(maxStart / 2), maxStart]);

  for (const start of starts) {
    if (start < 0 || start > maxStart) continue;
    addFragment(target, value.slice(start, start + windowSize));
  }
}

function isPureCjkToken(value: string): boolean {
  return value.length > 0 && Array.from(value).every((char) => CJK_LIKE_RE.test(char));
}

function buildNgramFragments(value: string, size: number): string[] {
  const chars = Array.from(value);
  if (chars.length < size) return [];

  const fragments: string[] = [];
  const seen = new Set<string>();

  for (let start = 0; start <= chars.length - size; start += 1) {
    const fragment = chars.slice(start, start + size).join('');
    if (seen.has(fragment)) continue;
    seen.add(fragment);
    fragments.push(fragment);
  }

  return fragments;
}

function buildLongCjkFragments(value: string): string[] {
  const chars = Array.from(value);
  if (chars.length < 5) return [];
  if (chars.length <= 8) return [value];

  const fragments = new Set<string>();
  const sizes = [5, 6];

  for (const size of sizes) {
    if (chars.length < size) continue;
    const maxStart = chars.length - size;
    const starts = new Set([0, 1, Math.floor(maxStart / 2), maxStart - 1, maxStart]);

    for (const start of starts) {
      if (start < 0 || start > maxStart) continue;
      addFragment(fragments, chars.slice(start, start + size).join(''));
    }
  }

  return Array.from(fragments);
}

function flattenRoundRobin(groups: string[][]): string[] {
  const indices = new Array<number>(groups.length).fill(0);
  const flattened: string[] = [];
  const seen = new Set<string>();
  let exhausted = false;

  while (!exhausted) {
    exhausted = true;

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const pointer = indices[index];
      if (pointer >= group.length) continue;

      exhausted = false;
      indices[index] += 1;

      const fragment = group[pointer];
      if (seen.has(fragment)) continue;

      seen.add(fragment);
      flattened.push(fragment);
    }
  }

  return flattened;
}

function takeFragments(
  target: string[],
  source: string[],
  count: number,
  seen: Set<string>,
): number {
  if (count <= 0) return 0;

  let taken = 0;

  for (const fragment of source) {
    if (seen.has(fragment)) continue;

    seen.add(fragment);
    target.push(fragment);
    taken += 1;

    if (taken >= count) break;
  }

  return taken;
}

function normalizeBudget(budget: number, maxBudget: number): number {
  return Math.max(0, Math.min(budget, maxBudget));
}

function tokenizeSearchText(
  value: string,
  options?: TermNormalizationOptions,
): {
  wholeTokens: string[];
  fragmentTokens: string[];
} {
  const normalized = sanitizeSearchText(normalizeTermForLookup(value, options));
  if (!normalized) {
    return {
      wholeTokens: [],
      fragmentTokens: [],
    };
  }

  const wholeTokens = normalized.split(' ').filter((token) => token.length > 0);

  return {
    wholeTokens,
    fragmentTokens: wholeTokens
      .flatMap((token) => splitMixedScriptToken(token))
      .filter((token) => token.length >= 2),
  };
}

function buildExactLookupTerms(tokens: string[]): string[] {
  const shortExactTokens = tokens.filter((token) => !isPureCjkToken(token) && token.length <= 3);
  const cjkTokens = tokens.filter((token) => isPureCjkToken(token));
  if (cjkTokens.length === 0 && shortExactTokens.length === 0) return [];

  const groups = CJK_EXACT_TERM_SIZES.map((size) =>
    flattenRoundRobin(cjkTokens.map((token) => buildNgramFragments(token, size))),
  );
  groups.push(shortExactTokens);

  return flattenRoundRobin(groups.map((group) => group.slice()));
}

function buildFtsSearchFragments(tokens: string[], maxFragments: number): string[] {
  if (tokens.length === 0) return [];

  const cjkTokens = tokens.filter((token) => isPureCjkToken(token));
  const generalTokens = tokens.filter((token) => !isPureCjkToken(token));

  const cjkLength4 = flattenRoundRobin(cjkTokens.map((token) => buildNgramFragments(token, 4)));
  const cjkLength3 = flattenRoundRobin(cjkTokens.map((token) => buildNgramFragments(token, 3)));
  const cjkLength2 = flattenRoundRobin(cjkTokens.map((token) => buildNgramFragments(token, 2)));
  const cjkLong = flattenRoundRobin(cjkTokens.map((token) => buildLongCjkFragments(token)));

  const generalSingles = flattenRoundRobin(generalTokens.map((token) => [token]));
  const generalWindows = flattenRoundRobin(
    generalTokens.map((token) => {
      const fragments = new Set<string>([token]);
      if (token.length > 12) {
        addWindowFragments(
          fragments,
          token,
          Math.min(16, Math.max(4, Math.floor(token.length * 0.5))),
        );
      }
      return Array.from(fragments);
    }),
  );
  const generalPairs = flattenRoundRobin(
    tokens.slice(0, -1).map((token, index) => {
      const next = tokens[index + 1];
      if (isPureCjkToken(token) || isPureCjkToken(next)) return [];
      return [`${token} ${next}`];
    }),
  );

  const hasCjk = cjkTokens.length > 0;
  const hasGeneral = generalTokens.length > 0;

  const generalBudget = hasGeneral
    ? hasCjk
      ? Math.max(4, Math.min(8, Math.floor(maxFragments * 0.25)))
      : maxFragments
    : 0;
  const cjkBudget = hasCjk ? maxFragments - generalBudget : 0;

  const selected: string[] = [];
  const seen = new Set<string>();

  if (hasCjk) {
    // FTS5 trigram retrieval benefits most from 3-character CJK fragments, because
    // they can directly recall 3-char terms and also recall longer terms via inner trigrams.
    const length3Budget = normalizeBudget(Math.max(6, cjkBudget - 6), cjkBudget);
    const remainingBudget = Math.max(0, cjkBudget - length3Budget);
    const length4Budget = normalizeBudget(Math.ceil(remainingBudget * 0.5), remainingBudget);
    const longBudget = normalizeBudget(
      Math.floor(remainingBudget * 0.3),
      remainingBudget - length4Budget,
    );
    const length2Budget = Math.max(0, remainingBudget - length4Budget - longBudget);

    takeFragments(selected, cjkLength3, length3Budget, seen);
    takeFragments(selected, cjkLength4, length4Budget, seen);
    takeFragments(selected, cjkLong, longBudget, seen);
    takeFragments(selected, cjkLength2, length2Budget, seen);
  }

  if (hasGeneral) {
    const phraseBudget = normalizeBudget(Math.max(2, Math.ceil(generalBudget * 0.45)), generalBudget);
    const singleBudget = normalizeBudget(
      Math.max(1, Math.floor(generalBudget * 0.35)),
      generalBudget - phraseBudget,
    );
    const windowBudget = Math.max(0, generalBudget - phraseBudget - singleBudget);

    takeFragments(selected, generalPairs, phraseBudget, seen);
    takeFragments(selected, generalSingles, singleBudget, seen);
    takeFragments(selected, generalWindows, windowBudget, seen);
  }

  const fillOrder = [
    cjkLength3,
    cjkLength4,
    generalPairs,
    cjkLong,
    generalSingles,
    cjkLength2,
    generalWindows,
  ];

  for (const candidates of fillOrder) {
    if (selected.length >= maxFragments) break;
    takeFragments(selected, candidates, maxFragments - selected.length, seen);
  }

  return selected.slice(0, maxFragments);
}

export function normalizeTermForLookup(
  value: string,
  options?: TermNormalizationOptions,
): string {
  const locale = resolveLocale(value, options?.locale);
  return normalizeTextWithIndexMap(value, locale).text;
}

export function buildTermSearchPlan(
  value: string,
  options?: TermSearchFragmentOptions,
): TermSearchPlan {
  const tokens = tokenizeSearchText(value, options);
  if (tokens.wholeTokens.length === 0) {
    return {
      ftsFragments: [],
      exactLookupTerms: [],
    };
  }

  const maxFragments = Math.max(6, options?.maxFragments ?? DEFAULT_MAX_FRAGMENTS);

  return {
    ftsFragments: buildFtsSearchFragments(tokens.fragmentTokens, maxFragments),
    exactLookupTerms: buildExactLookupTerms(tokens.wholeTokens),
  };
}

export function buildTermSearchFragments(
  value: string,
  options?: TermSearchFragmentOptions,
): string[] {
  return buildTermSearchPlan(value, options).ftsFragments;
}

export function findTermPositionsInText(
  text: string,
  term: string,
  options?: TermSearchOptions,
): TermMatchPosition[] {
  const locale = resolveLocale(term, options?.locale);
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

  return (
    outer.start <= inner.start &&
    outer.end >= inner.end &&
    outerLength > innerLength
  );
}

export function suppressNestedTermMatches<T extends { positions: TermMatchPosition[] }>(
  matches: T[],
): T[] {
  const occupiedRanges: TermMatchPosition[] = [];
  const selected: T[] = [];

  for (const match of matches) {
    const visiblePositions = match.positions.filter(
      (position) =>
        !occupiedRanges.some((range) => isStrictlyContainedPosition(position, range)),
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
