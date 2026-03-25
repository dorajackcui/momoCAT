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

const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const CJK_LIKE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

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

export function normalizeTermForLookup(
  value: string,
  options?: TermNormalizationOptions,
): string {
  const locale = resolveLocale(value, options?.locale);
  return normalizeTextWithIndexMap(value, locale).text;
}

export function buildTermSearchFragments(
  value: string,
  options?: TermSearchFragmentOptions,
): string[] {
  const normalized = sanitizeSearchText(normalizeTermForLookup(value, options));
  if (!normalized) return [];

  const fragments = new Set<string>();
  const tokens = normalized
    .split(' ')
    .flatMap((token) => splitMixedScriptToken(token))
    .filter((token) => token.length >= 2);

  if (tokens.length === 0) return [];

  for (const token of tokens) {
    addFragment(fragments, token);

    if (CJK_LIKE_RE.test(token) && token.length >= 4) {
      addWindowFragments(
        fragments,
        token,
        Math.min(12, Math.max(4, Math.floor(token.length * 0.45))),
      );
    } else if (token.length > 12) {
      const windowSize = Math.min(16, Math.max(4, Math.floor(token.length * 0.5)));
      addWindowFragments(fragments, token, windowSize);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    addFragment(fragments, `${tokens[index]} ${tokens[index + 1]}`);
  }

  if (tokens.length === 1 && CJK_LIKE_RE.test(tokens[0]) && tokens[0].length >= 4) {
    addWindowFragments(
      fragments,
      tokens[0],
      Math.min(12, Math.max(4, Math.floor(tokens[0].length * 0.45))),
    );
  }

  return Array.from(fragments)
    .sort((a, b) => b.length - a.length)
    .slice(0, options?.maxFragments ?? 12);
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
