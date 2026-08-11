import {
  CJK_LIKE_RE,
  LETTER_OR_NUMBER_RE,
  normalizeTermForLookup,
  type TermNormalizationOptions,
} from './termNormalization';

export interface TermSearchFragmentOptions extends TermNormalizationOptions {
  maxFragments?: number;
}

export interface TermSearchPlan {
  ftsFragments: string[];
  exactLookupTerms: string[];
}

const DEFAULT_MAX_FRAGMENTS = 24;
const CJK_EXACT_TERM_MIN_SIZE = 2;
const CJK_EXACT_TERM_MAX_SIZE = 8;
const CJK_DISTRIBUTED_LATE_COVERAGE_RATIO = 0.8;

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

function buildCjkExactLookupTerms(tokens: string[]): string[] {
  const groups: string[][] = [];

  for (let size = CJK_EXACT_TERM_MAX_SIZE; size >= CJK_EXACT_TERM_MIN_SIZE; size -= 1) {
    groups.push(flattenRoundRobin(tokens.map((token) => buildNgramFragments(token, size))));
  }

  return flattenRoundRobin(groups.map((group) => group.slice()));
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

function findNearestUnusedFragmentIndex(
  source: string[],
  preferredIndex: number,
  seen: Set<string>,
  usedIndices: Set<number>,
): number | null {
  for (let distance = 0; distance < source.length; distance += 1) {
    const left = preferredIndex - distance;
    if (left >= 0 && !usedIndices.has(left) && !seen.has(source[left])) return left;

    const right = preferredIndex + distance;
    if (right < source.length && !usedIndices.has(right) && !seen.has(source[right])) {
      return right;
    }
  }

  return null;
}

function takeDistributedFragments(
  target: string[],
  source: string[],
  count: number,
  seen: Set<string>,
): number {
  if (count <= 0 || source.length === 0) return 0;
  if (count >= source.length) return takeFragments(target, source, count, seen);

  const usedIndices = new Set<number>();
  const leadingCount = count <= 3 ? count : Math.max(1, Math.floor(count / 2));
  let taken = takeFragments(target, source, leadingCount, seen);
  if (taken >= count) return taken;

  const distributedCount = count - taken;
  const tailIndex = source.length - 1;
  const coverageStartIndex = Math.min(tailIndex, leadingCount);
  const lateCoverageIndex = Math.max(
    coverageStartIndex,
    Math.floor(tailIndex * CJK_DISTRIBUTED_LATE_COVERAGE_RATIO),
  );

  for (let slot = 0; slot < distributedCount; slot += 1) {
    let preferredIndex = tailIndex;

    if (distributedCount > 1 && slot < distributedCount - 1) {
      const preTailSlots = distributedCount - 1;
      preferredIndex =
        preTailSlots === 1
          ? lateCoverageIndex
          : Math.round(
              coverageStartIndex +
                ((lateCoverageIndex - coverageStartIndex) * slot) / (preTailSlots - 1),
            );
    }

    const index = findNearestUnusedFragmentIndex(source, preferredIndex, seen, usedIndices);
    if (index === null) continue;

    usedIndices.add(index);
    seen.add(source[index]);
    target.push(source[index]);
    taken += 1;
  }

  if (taken < count) {
    taken += takeFragments(target, source, count - taken, seen);
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

function buildExactLookupTerms(wholeTokens: string[], fragmentTokens: string[]): string[] {
  const shortExactTokens = wholeTokens.filter(
    (token) => !isPureCjkToken(token) && token.length <= 3,
  );
  const cjkTokens = fragmentTokens.filter(
    (token) => isPureCjkToken(token) && Array.from(token).length >= CJK_EXACT_TERM_MIN_SIZE,
  );
  if (cjkTokens.length === 0 && shortExactTokens.length === 0) return [];

  const groups = [buildCjkExactLookupTerms(cjkTokens), shortExactTokens];

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

    takeDistributedFragments(selected, cjkLength3, length3Budget, seen);
    takeDistributedFragments(selected, cjkLength4, length4Budget, seen);
    takeDistributedFragments(selected, cjkLong, longBudget, seen);
    takeDistributedFragments(selected, cjkLength2, length2Budget, seen);
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
    const remaining = maxFragments - selected.length;
    if (
      candidates === cjkLength3 ||
      candidates === cjkLength4 ||
      candidates === cjkLong ||
      candidates === cjkLength2
    ) {
      takeDistributedFragments(selected, candidates, remaining, seen);
    } else {
      takeFragments(selected, candidates, remaining, seen);
    }
  }

  return selected.slice(0, maxFragments);
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
    exactLookupTerms: buildExactLookupTerms(tokens.wholeTokens, tokens.fragmentTokens),
  };
}

export function buildTermSearchFragments(
  value: string,
  options?: TermSearchFragmentOptions,
): string[] {
  return buildTermSearchPlan(value, options).ftsFragments;
}
