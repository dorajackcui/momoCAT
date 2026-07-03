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
  tokens: string[];
  separators: SeparatorRule[];
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
  separators: SeparatorRule[];
}

interface SeparatorRule {
  kind: 'whitespace' | 'hyphen' | 'exact' | 'dotted-acronym' | 'dotted-acronym-final';
  value?: string;
}

interface TermTokenization {
  normalizedText: string;
  units: TermUnit[];
  tokens: string[];
  separators: SeparatorRule[];
}

interface TermUnit {
  raw: string;
  start: number;
  end: number;
  fragment: TermFragment;
}

interface TermFragment {
  tokens: string[];
  separators: SeparatorRule[];
  requiresFinalAcronymPeriod: boolean;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
const RAW_TERM_TOKEN_RE = /[A-Z](?:\.[A-Z]){1,4}\.?|[\p{L}\p{N}]+/gu;
const LETTER_RE = /\p{L}/u;
const HYPHEN_RE = /[-\u2010-\u2015]/u;
const HYPHEN_SEPARATOR_RE = /^[\s\u2010-\u2015-]+$/u;
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
          tokens: variant.tokens,
          separators: variant.separators,
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
          if (!hasExpectedSeparators(text, sourceTokens, startIndex, endIndex, variant)) {
            continue;
          }

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
  const term = tokenizeTerm(srcTerm);
  if (term.tokens.length === 0) return [];

  addVariantWithHyphenSpace(
    variants,
    term.tokens,
    term.separators,
    'canonical',
    normalizeVariantText(srcTerm),
  );
  addArticleVariants(variants, term.tokens, term.separators);
  addFinalInflectionVariants(variants, term.tokens, term.separators);
  addAcronymVariants(variants, term);

  return Array.from(variants.values());
}

function addVariant(
  variants: Map<string, TermVariant>,
  tokens: string[],
  separators: SeparatorRule[],
  kind: EnglishTermVariantKind,
  text = tokens.join(' '),
): void {
  if (tokens.length === 0) return;
  if (separators.length !== tokens.length - 1) return;
  const key = variantIdentity(tokens, separators);
  if (variants.has(key)) return;
  variants.set(key, { kind, text, tokens, separators });
}

function addVariantWithHyphenSpace(
  variants: Map<string, TermVariant>,
  tokens: string[],
  separators: SeparatorRule[],
  kind: EnglishTermVariantKind,
  text = tokens.join(' '),
): void {
  addVariant(variants, tokens, separators, kind, text);
  addHyphenSpaceVariants(variants, tokens, separators);
}

function addHyphenSpaceVariants(
  variants: Map<string, TermVariant>,
  tokens: string[],
  separators: SeparatorRule[],
): void {
  for (let index = 0; index < separators.length; index += 1) {
    const replacement = toHyphenSpaceSeparator(separators[index]);
    if (!replacement) continue;
    const variantSeparators = separators.slice();
    variantSeparators[index] = replacement;
    addVariant(variants, tokens, variantSeparators, 'hyphen-space');
  }
}

function addArticleVariants(
  variants: Map<string, TermVariant>,
  canonicalTokens: string[],
  canonicalSeparators: SeparatorRule[],
): void {
  const [first, ...rest] = canonicalTokens;
  if (ENGLISH_ARTICLES.has(first)) {
    addVariantWithHyphenSpace(variants, rest, canonicalSeparators.slice(1), 'article');
    return;
  }

  for (const article of ENGLISH_ARTICLES) {
    addVariantWithHyphenSpace(
      variants,
      [article, ...canonicalTokens],
      [{ kind: 'whitespace' }, ...canonicalSeparators],
      'article',
    );
  }
}

function addFinalInflectionVariants(
  variants: Map<string, TermVariant>,
  canonicalTokens: string[],
  canonicalSeparators: SeparatorRule[],
): void {
  const last = canonicalTokens[canonicalTokens.length - 1];
  const prefix = canonicalTokens.slice(0, -1);
  const singular = singularizeRegularWord(last);
  const plural = pluralizeRegularWord(last);

  if (singular) {
    addVariantWithHyphenSpace(variants, [...prefix, singular], canonicalSeparators, 'inflection');
  }
  if (plural) {
    addVariantWithHyphenSpace(variants, [...prefix, plural], canonicalSeparators, 'inflection');
  }
}

function addAcronymVariants(
  variants: Map<string, TermVariant>,
  term: TermTokenization,
): void {
  for (let index = 0; index < term.units.length; index += 1) {
    const acronymFragment = buildAcronymFragment(term.units[index].raw);
    if (!acronymFragment) continue;

    const fragments = term.units.map((unit, unitIndex) =>
      unitIndex === index ? acronymFragment : unit.fragment,
    );
    const variant = buildVariantFromFragments(term, fragments, 'acronym');
    addVariant(variants, variant.tokens, variant.separators, variant.kind, variant.text);
  }
}

function buildAcronymFragment(rawToken: string): TermFragment | null {
  const raw = rawToken.normalize('NFKC').trim();
  if (/^[A-Z]{2,5}$/u.test(raw)) {
    const tokens = Array.from(raw.toLowerCase());
    return {
      tokens,
      separators: tokens.slice(1).map(() => ({ kind: 'dotted-acronym' })),
      requiresFinalAcronymPeriod: true,
    };
  }
  if (/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) {
    return {
      tokens: [raw.replace(/\./g, '').toLowerCase()],
      separators: [],
      requiresFinalAcronymPeriod: false,
    };
  }
  return null;
}

function tokenizeTerm(value: string): TermTokenization {
  const normalizedText = value.normalize('NFKC');
  const units = Array.from(normalizedText.matchAll(RAW_TERM_TOKEN_RE), (match) => ({
    raw: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    fragment: buildTermFragment(match[0]),
  })).filter((unit) => unit.fragment.tokens.length > 0);
  const canonical = buildVariantFromFragments(
    { normalizedText, units },
    units.map((unit) => unit.fragment),
    'canonical',
  );

  return {
    normalizedText,
    units,
    tokens: canonical.tokens,
    separators: canonical.separators,
  };
}

function buildVariantFromFragments(
  term: Pick<TermTokenization, 'normalizedText' | 'units'>,
  fragments: TermFragment[],
  kind: EnglishTermVariantKind,
): TermVariant {
  const tokens: string[] = [];
  const separators: SeparatorRule[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    if (fragment.tokens.length === 0) continue;

    if (tokens.length > 0) {
      separators.push(buildInterUnitSeparator(term, fragments[index - 1], index));
    }

    tokens.push(fragment.tokens[0]);
    for (let tokenIndex = 1; tokenIndex < fragment.tokens.length; tokenIndex += 1) {
      separators.push(fragment.separators[tokenIndex - 1]);
      tokens.push(fragment.tokens[tokenIndex]);
    }
  }

  return {
    kind,
    text: tokens.join(' '),
    tokens,
    separators,
  };
}

function buildInterUnitSeparator(
  term: Pick<TermTokenization, 'normalizedText' | 'units'>,
  previousFragment: TermFragment,
  unitIndex: number,
): SeparatorRule {
  const separator = term.normalizedText.slice(
    term.units[unitIndex - 1].end,
    term.units[unitIndex].start,
  );

  if (previousFragment.requiresFinalAcronymPeriod && /^\s+$/u.test(separator)) {
    return { kind: 'dotted-acronym-final' };
  }

  return buildCanonicalSeparator(separator);
}

function buildTermFragment(rawValue: string): TermFragment {
  const normalized = rawValue.normalize('NFKC');
  const matches = Array.from(normalized.matchAll(WORD_RE));
  const tokens = matches.map((match) => normalizeToken(match[0]));
  const separators: SeparatorRule[] = [];

  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1];
    const current = matches[index];
    const previousEnd = (previous.index ?? 0) + previous[0].length;
    separators.push(buildCanonicalSeparator(normalized.slice(previousEnd, current.index ?? 0)));
  }

  return {
    tokens,
    separators,
    requiresFinalAcronymPeriod: /^[A-Z](?:\.[A-Z]){1,4}\.$/u.test(normalized),
  };
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

function hasExpectedSeparators<T extends EnglishTermRecognizerEntry>(
  text: string,
  sourceTokens: SourceToken[],
  startIndex: number,
  endIndex: number,
  variant: IndexedVariant<T>,
): boolean {
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const separator = text.slice(sourceTokens[index - 1].end, sourceTokens[index].start);
    const variantTokenIndex = index - startIndex;
    if (!matchesSeparatorRule(separator, variant.separators[variantTokenIndex - 1])) {
      return false;
    }
  }

  return true;
}

function buildCanonicalSeparator(separator: string): SeparatorRule {
  const normalized = normalizeSeparator(separator);
  if (/^\s+$/u.test(normalized)) return { kind: 'whitespace' };
  if (HYPHEN_RE.test(normalized) && HYPHEN_SEPARATOR_RE.test(normalized)) {
    return { kind: 'hyphen' };
  }
  return { kind: 'exact', value: normalized };
}

function matchesSeparatorRule(separator: string, rule: SeparatorRule): boolean {
  const normalized = normalizeSeparator(separator);
  switch (rule.kind) {
    case 'whitespace':
      return /^\s+$/u.test(normalized);
    case 'hyphen':
      return HYPHEN_RE.test(normalized) && HYPHEN_SEPARATOR_RE.test(normalized);
    case 'exact':
      return normalized === rule.value;
    case 'dotted-acronym':
      return normalized === '.';
    case 'dotted-acronym-final':
      return /^\.\s+$/u.test(normalized);
  }
}

function toHyphenSpaceSeparator(separator: SeparatorRule): SeparatorRule | null {
  switch (separator.kind) {
    case 'whitespace':
      return { kind: 'hyphen' };
    case 'hyphen':
      return { kind: 'whitespace' };
    default:
      return null;
  }
}

function normalizeSeparator(separator: string): string {
  return separator.normalize('NFKC');
}

function variantIdentity(tokens: string[], separators: SeparatorRule[]): string {
  return `${tokens.join('\u0001')}\u0002${separators.map(separatorIdentity).join('\u0001')}`;
}

function separatorIdentity(separator: SeparatorRule): string {
  return separator.value ? `${separator.kind}:${separator.value}` : separator.kind;
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
