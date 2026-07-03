export type EnglishTermVariantKind =
  | 'canonical'
  | 'article'
  | 'hyphen-space'
  | 'acronym'
  | 'inflection';

export interface EnglishTermRecognizerEntry {
  id: string;
  srcTerm: string;
  priority?: number;
  usageCount?: number;
}

export interface EnglishTermRecognizerMatch<T extends EnglishTermRecognizerEntry> {
  entry: T;
  variantKind: EnglishTermVariantKind;
  variantText: string;
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
}

export interface EnglishTermRecognizerScanOptions {
  hardBoundaryOffsets?: number[];
}

interface IndexedVariant<T extends EnglishTermRecognizerEntry> {
  entry: T;
  key: string;
  tokenCount: number;
  variantKind: EnglishTermVariantKind;
  variantText: string;
}

interface SourceToken {
  value: string;
  start: number;
  end: number;
}

interface TermVariant {
  kind: EnglishTermVariantKind;
  text: string;
  tokens: string[];
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
const RAW_TERM_TOKEN_RE = /[A-Z](?:\.[A-Z]){1,4}\.?|[\p{L}\p{N}]+/gu;
const LETTER_RE = /\p{L}/u;
const HYPHEN_RE = /[-\u2010-\u2015]/u;
const ENGLISH_ARTICLES = new Set(['the', 'a', 'an']);
const INVARIANT_S_WORDS = new Set(['does', 'news', 'series', 'species']);

export class EnglishTermRecognizer<T extends EnglishTermRecognizerEntry> {
  private readonly variantsByKey = new Map<string, IndexedVariant<T>[]>();
  private readonly maxTokenCount: number;

  public constructor(entries: T[]) {
    let maxTokenCount = 0;

    for (const entry of entries) {
      for (const variant of buildEnglishTermVariants(entry.srcTerm)) {
        const key = variant.tokens.join(' ');
        const indexed: IndexedVariant<T> = {
          entry,
          key,
          tokenCount: variant.tokens.length,
          variantKind: variant.kind,
          variantText: variant.text,
        };
        const bucket = this.variantsByKey.get(key) ?? [];
        bucket.push(indexed);
        this.variantsByKey.set(key, bucket);
        maxTokenCount = Math.max(maxTokenCount, variant.tokens.length);
      }
    }

    for (const bucket of this.variantsByKey.values()) {
      bucket.sort(compareIndexedVariants);
    }

    this.maxTokenCount = maxTokenCount;
  }

  public scan(
    text: string,
    options: EnglishTermRecognizerScanOptions = {},
  ): EnglishTermRecognizerMatch<T>[] {
    if (this.maxTokenCount === 0) return [];

    const sourceTokens = tokenizeSource(text);
    const hardBoundaryOffsets = options.hardBoundaryOffsets ?? [];
    const matches: EnglishTermRecognizerMatch<T>[] = [];

    for (let startIndex = 0; startIndex < sourceTokens.length; startIndex += 1) {
      const parts: string[] = [];
      const maxEnd = Math.min(sourceTokens.length, startIndex + this.maxTokenCount);

      for (let endIndex = startIndex; endIndex < maxEnd; endIndex += 1) {
        const start = sourceTokens[startIndex].start;
        const end = sourceTokens[endIndex].end;
        if (crossesHardBoundary(start, end, hardBoundaryOffsets)) break;

        parts.push(sourceTokens[endIndex].value);
        const variants = this.variantsByKey.get(parts.join(' '));
        if (!variants) continue;

        for (const variant of variants) {
          matches.push({
            entry: variant.entry,
            variantKind: resolveMatchVariantKind(variant, text.slice(start, end)),
            variantText: variant.variantText,
            start,
            end,
            tokenStart: startIndex,
            tokenEnd: endIndex + 1,
          });
        }
      }
    }

    return suppressNestedSameEntryMatches(matches.sort(compareMatches));
  }
}

export function buildEnglishTermRecognizer<T extends EnglishTermRecognizerEntry>(
  entries: T[],
): EnglishTermRecognizer<T> {
  return new EnglishTermRecognizer(entries);
}

function buildEnglishTermVariants(srcTerm: string): TermVariant[] {
  const variants = new Map<string, TermVariant>();
  const canonicalTokens = tokenizeKey(srcTerm);
  if (canonicalTokens.length === 0) return [];

  addVariant(variants, canonicalTokens, 'canonical', normalizeVariantText(srcTerm));
  addArticleVariants(variants, canonicalTokens);
  addFinalInflectionVariants(variants, canonicalTokens);
  addAcronymVariants(variants, srcTerm);

  return Array.from(variants.values());
}

function addVariant(
  variants: Map<string, TermVariant>,
  tokens: string[],
  kind: EnglishTermVariantKind,
  text = tokens.join(' '),
): void {
  if (tokens.length === 0) return;
  const key = tokens.join(' ');
  if (variants.has(key)) return;
  variants.set(key, { kind, text, tokens });
}

function addArticleVariants(
  variants: Map<string, TermVariant>,
  canonicalTokens: string[],
): void {
  const [first, ...rest] = canonicalTokens;
  if (ENGLISH_ARTICLES.has(first)) {
    addVariant(variants, rest, 'article');
    return;
  }

  for (const article of ENGLISH_ARTICLES) {
    addVariant(variants, [article, ...canonicalTokens], 'article');
  }
}

function addFinalInflectionVariants(
  variants: Map<string, TermVariant>,
  canonicalTokens: string[],
): void {
  const last = canonicalTokens[canonicalTokens.length - 1];
  const prefix = canonicalTokens.slice(0, -1);
  const singular = singularizeRegularWord(last);
  const plural = pluralizeRegularWord(last);

  if (singular) addVariant(variants, [...prefix, singular], 'inflection');
  if (plural) addVariant(variants, [...prefix, plural], 'inflection');
}

function addAcronymVariants(
  variants: Map<string, TermVariant>,
  srcTerm: string,
): void {
  const rawTokens = tokenizeRawTermTokens(srcTerm);

  for (let index = 0; index < rawTokens.length; index += 1) {
    const acronymTokens = buildAcronymTokens(rawTokens[index]);
    if (!acronymTokens) continue;

    const tokens = rawTokens.flatMap((token, tokenIndex) =>
      tokenIndex === index ? acronymTokens : tokenizeKey(token),
    );
    addVariant(variants, tokens, 'acronym');
  }
}

function buildAcronymTokens(rawToken: string): string[] | null {
  const raw = rawToken.normalize('NFKC').trim();
  if (/^[A-Z]{2,5}$/u.test(raw)) return Array.from(raw.toLowerCase());
  if (/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) {
    return [raw.replace(/\./g, '').toLowerCase()];
  }
  return null;
}

function tokenizeRawTermTokens(value: string): string[] {
  return Array.from(value.normalize('NFKC').matchAll(RAW_TERM_TOKEN_RE), (match) => match[0]);
}

function tokenizeKey(value: string): string[] {
  return Array.from(value.normalize('NFKC').matchAll(WORD_RE), (match) =>
    normalizeToken(match[0]),
  );
}

function tokenizeSource(text: string): SourceToken[] {
  return Array.from(text.matchAll(WORD_RE), (match) => ({
    value: normalizeToken(match[0]),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function normalizeToken(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function normalizeVariantText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveMatchVariantKind<T extends EnglishTermRecognizerEntry>(
  variant: IndexedVariant<T>,
  matchedText: string,
): EnglishTermVariantKind {
  if (variant.variantKind !== 'canonical') return variant.variantKind;

  const matchedVariantText = normalizeVariantText(matchedText);
  if (
    HYPHEN_RE.test(variant.variantText) !== HYPHEN_RE.test(matchedVariantText) &&
    tokenizeKey(variant.variantText).join(' ') === tokenizeKey(matchedVariantText).join(' ')
  ) {
    return 'hyphen-space';
  }

  return 'canonical';
}

function crossesHardBoundary(start: number, end: number, hardBoundaryOffsets: number[]): boolean {
  return hardBoundaryOffsets.some((offset) => start < offset && offset < end);
}

function suppressNestedSameEntryMatches<T extends EnglishTermRecognizerEntry>(
  matches: Array<EnglishTermRecognizerMatch<T>>,
): Array<EnglishTermRecognizerMatch<T>> {
  const selected: Array<EnglishTermRecognizerMatch<T>> = [];

  for (const match of matches) {
    if (
      selected.some(
        (existing) =>
          existing.entry.id === match.entry.id && isStrictlyContainedMatch(match, existing),
      )
    ) {
      continue;
    }

    selected.push(match);
  }

  return selected;
}

function isStrictlyContainedMatch<T extends EnglishTermRecognizerEntry>(
  inner: EnglishTermRecognizerMatch<T>,
  outer: EnglishTermRecognizerMatch<T>,
): boolean {
  const innerLength = inner.end - inner.start;
  const outerLength = outer.end - outer.start;
  return outer.start <= inner.start && outer.end >= inner.end && outerLength > innerLength;
}

function pluralizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 3) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/zz$/i.test(value)) return `${value}es`;
  if (/z$/i.test(value)) return `${value}zes`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

function singularizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 4) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (INVARIANT_S_WORDS.has(value.toLowerCase())) return null;
  if (/[^aeiou]ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/zzes$/i.test(value)) return value.slice(0, -3);
  if (/(ches|shes|xes|zes)$/i.test(value)) return value.slice(0, -2);
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/^(buses|gases)$/i.test(value)) return value.slice(0, -2);
  if (/ses$/i.test(value)) return value.slice(0, -1);
  if (value.length >= 5 && !/(ss|us|is)$/i.test(value) && /s$/i.test(value)) {
    return value.slice(0, -1);
  }
  return null;
}

function compareIndexedVariants<T extends EnglishTermRecognizerEntry>(
  a: IndexedVariant<T>,
  b: IndexedVariant<T>,
): number {
  if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
  return variantRank(a.variantKind) - variantRank(b.variantKind);
}

function compareMatches<T extends EnglishTermRecognizerEntry>(
  a: EnglishTermRecognizerMatch<T>,
  b: EnglishTermRecognizerMatch<T>,
): number {
  if (a.start !== b.start) return a.start - b.start;
  if (b.end !== a.end) return b.end - a.end;
  return variantRank(a.variantKind) - variantRank(b.variantKind);
}

function variantRank(kind: EnglishTermVariantKind): number {
  switch (kind) {
    case 'canonical':
      return 0;
    case 'article':
      return 1;
    case 'hyphen-space':
      return 2;
    case 'acronym':
      return 3;
    case 'inflection':
      return 4;
  }
}
