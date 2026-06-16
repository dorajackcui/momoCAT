export type TMTextProfile = 'default' | 'english';

const MAX_ENGLISH_TM_RECALL_TERMS = 32;
const WORD_RE = /[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu;
const SIMPLE_WORD_RE = /[\p{L}\p{N}]+/gu;
const LETTER_RE = /\p{L}/u;
const ENGLISH_TM_CONCORDANCE_BOUNDARY_SEPARATOR_RE =
  /[\r\n,.!?:;|()[\]{}"'\/\\\u2018\u2019\u201c\u201d\u3001\u3002\u2010-\u2015-]/u;
const ENGLISH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);
const MAX_ENGLISH_TM_CONCORDANCE_EXACT_PHRASES = 24;
const MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES = 48;
const ENGLISH_PHRASE_BOUNDARY_STOPWORDS = new Set([
  ...ENGLISH_STOPWORDS,
  'after',
  'before',
  'besides',
  'during',
  'if',
  'inside',
  'into',
  'near',
  'once',
  'outside',
  'over',
  'then',
  'through',
  'under',
  'when',
  'while',
  'within',
]);
const INVARIANT_S_WORDS = new Set(['does', 'news', 'series', 'species']);

export function resolveTMTextProfile(locale?: string): TMTextProfile {
  const normalized = locale?.toLowerCase();
  if (normalized === 'en' || normalized?.startsWith('en-')) return 'english';
  return 'default';
}

export function normalizeTextForTMSimilarity(
  text: string,
  profile: TMTextProfile = 'default',
): string {
  if (profile !== 'english') {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  return text
    .normalize('NFKC')
    .replace(/([A-Z])\.(?=[A-Z](?:\.|$))/g, '$1')
    .replace(/(?:'|\u2019)s\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => singularizeRegularWord(token) ?? token)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildEnglishTMRecallTerms(text: string): string[] {
  const terms = new Set<string>();
  const rawTokens = Array.from(text.normalize('NFKC').matchAll(WORD_RE)).map((match) => match[0]);
  const canonicalTokens = normalizeTextForTMSimilarity(text, 'english').split(/\s+/).filter(Boolean);

  for (const rawToken of rawTokens) {
    addRecallTerm(terms, undotAcronym(rawToken));
    addRecallTerm(terms, dottedAcronym(rawToken));
  }

  for (const token of canonicalTokens) {
    if (isSignificantEnglishToken(token)) {
      addRecallTerm(terms, token);
      addRecallTerm(terms, singularizeRegularWord(token));
      addRecallTerm(terms, pluralizeRegularWord(token));
    }
  }

  for (const phrase of buildSignificantEnglishPhrases(canonicalTokens)) {
    addRecallTerm(terms, phrase);
    addRecallTerm(terms, phrase.replace(/\s+/g, '-'));
    addTrailingWordInflectionTerms(terms, phrase);
    addTrailingWordInflectionTerms(terms, phrase.replace(/\s+/g, '-'));
  }

  return Array.from(terms).slice(0, MAX_ENGLISH_TM_RECALL_TERMS);
}

export interface EnglishTMConcordancePhraseTerms {
  exactPhrases: string[];
  ftsPhrases: string[];
}

export function buildEnglishTMConcordancePhraseTerms(
  text: string,
): EnglishTMConcordancePhraseTerms {
  const exactPhrases: string[] = [];
  const ftsPhrases: string[] = [];
  const seenExact = new Set<string>();
  const seenFts = new Set<string>();
  const tokenSegments = buildEnglishTMConcordanceTokenSegments(text);

  for (const rawTokens of tokenSegments) {
    for (let windowSize = 2; windowSize <= 4; windowSize += 1) {
      for (let index = 0; index <= rawTokens.length - windowSize; index += 1) {
        const slice = rawTokens.slice(index, index + windowSize);
        if (!hasNamedEnglishPhraseTokenShape(slice)) continue;
        if (countSignificantEnglishTokens(slice) < 2) continue;

        const exactPhrase = slice.join(' ');
        if (!hasNamedEnglishPhraseShape(exactPhrase)) continue;

        const canonical = normalizeTextForTMSimilarity(exactPhrase, 'english');
        const canonicalTokens = canonical.split(/\s+/).filter(Boolean);
        if (canonicalTokens.length < 2 || canonicalTokens.length > 4) continue;

        const first = canonicalTokens[0];
        const last = canonicalTokens[canonicalTokens.length - 1];
        if (
          ENGLISH_PHRASE_BOUNDARY_STOPWORDS.has(first) ||
          ENGLISH_PHRASE_BOUNDARY_STOPWORDS.has(last)
        ) {
          continue;
        }

        addBoundedCaseSensitiveTerm(
          exactPhrases,
          seenExact,
          exactPhrase,
          MAX_ENGLISH_TM_CONCORDANCE_EXACT_PHRASES,
        );

        addBoundedLowercaseTerm(
          ftsPhrases,
          seenFts,
          exactPhrase,
          MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES,
        );
        addBoundedLowercaseTerm(
          ftsPhrases,
          seenFts,
          canonical,
          MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES,
        );
      }
    }
  }

  return { exactPhrases, ftsPhrases };
}

export function hasEnglishTMConcordanceEvidence(queryText: string, candidateText: string): boolean {
  if (!hasNamedEnglishPhraseShape(candidateText)) return false;

  const query = normalizeTextForTMSimilarity(queryText, 'english');
  const candidate = normalizeTextForTMSimilarity(candidateText, 'english');
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;

  return containsCanonicalPhrase(query, candidate);
}

function addRecallTerm(target: Set<string>, value: string | null): void {
  const term = value?.trim();
  if (!term || target.size >= MAX_ENGLISH_TM_RECALL_TERMS) return;
  if (term.length < 3 && !/^[a-z]{2,5}$/i.test(term)) return;
  target.add(term.toLowerCase());
}

function addBoundedCaseSensitiveTerm(
  target: string[],
  seen: Set<string>,
  value: string,
  limit: number,
): void {
  const term = value.trim();
  if (!term || target.length >= limit || seen.has(term)) return;
  seen.add(term);
  target.push(term);
}

function addBoundedLowercaseTerm(
  target: string[],
  seen: Set<string>,
  value: string,
  limit: number,
): void {
  const term = value.trim().toLowerCase();
  if (!term || target.length >= limit || seen.has(term)) return;
  seen.add(term);
  target.push(term);
}

function buildEnglishTMConcordanceTokenSegments(text: string): string[][] {
  const segments: string[][] = [];
  let currentSegment: string[] = [];
  let previousTokenEnd = 0;
  const normalizedText = text.normalize('NFKC');

  for (const match of normalizedText.matchAll(WORD_RE)) {
    const token = match[0];
    const tokenStart = match.index ?? 0;
    const separator = normalizedText.slice(previousTokenEnd, tokenStart);
    const previousToken = currentSegment[currentSegment.length - 1];
    const previousTokenHasFinalAcronymPeriod = hasDottedAcronymFinalPeriodSeparator(
      separator,
      previousToken,
    );

    if (previousTokenHasFinalAcronymPeriod) {
      currentSegment[currentSegment.length - 1] = `${previousToken}.`;
    }

    if (
      currentSegment.length > 0 &&
      isEnglishTMConcordanceBoundarySeparator(separator, previousToken)
    ) {
      segments.push(currentSegment);
      currentSegment = [];
    }

    currentSegment.push(token);
    previousTokenEnd = tokenStart + token.length;
  }

  if (currentSegment.length > 0) segments.push(currentSegment);
  return segments;
}

function isEnglishTMConcordanceBoundarySeparator(
  separator: string,
  previousToken: string | undefined,
): boolean {
  if (!separator) return false;

  const boundaryText = hasDottedAcronymFinalPeriodSeparator(separator, previousToken)
    ? separator.replace(/^\.[^\S\r\n]*/u, '')
    : separator;
  return ENGLISH_TM_CONCORDANCE_BOUNDARY_SEPARATOR_RE.test(boundaryText);
}

function hasDottedAcronymFinalPeriodSeparator(
  separator: string,
  previousToken: string | undefined,
): boolean {
  return Boolean(
    previousToken && isDottedAcronymToken(previousToken) && /^\.[^\S\r\n]*/u.test(separator),
  );
}

function isDottedAcronymToken(token: string): boolean {
  return /^[A-Z](?:\.[A-Z]){1,4}$/u.test(token.normalize('NFKC'));
}

function hasNamedEnglishPhraseTokenShape(tokens: string[]): boolean {
  return tokens.every((token) => {
    const normalized = token.toLowerCase();
    if (isSignificantEnglishToken(normalized)) return isCapitalizedWord(token);
    return ENGLISH_STOPWORDS.has(normalized);
  });
}

function countSignificantEnglishTokens(tokens: string[]): number {
  return tokens.filter((token) => isSignificantEnglishToken(token.toLowerCase())).length;
}

function isSignificantEnglishToken(token: string): boolean {
  return token.length >= 3 && !ENGLISH_STOPWORDS.has(token) && LETTER_RE.test(token);
}

function containsCanonicalPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function hasNamedEnglishPhraseShape(text: string): boolean {
  const significantTokens = Array.from(text.normalize('NFKC').matchAll(SIMPLE_WORD_RE))
    .map((match) => match[0])
    .filter((token) => isSignificantEnglishToken(token.toLowerCase()));

  return (
    significantTokens.length >= 2 &&
    significantTokens.length <= 4 &&
    significantTokens.every(isCapitalizedWord)
  );
}

function isCapitalizedWord(token: string): boolean {
  const firstLetter = token.match(/\p{L}/u)?.[0];
  return Boolean(firstLetter && firstLetter === firstLetter.toUpperCase());
}

function buildSignificantEnglishPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  const maxWindow = Math.min(4, tokens.length);

  for (let windowSize = 2; windowSize <= maxWindow; windowSize += 1) {
    for (let index = 0; index <= tokens.length - windowSize; index += 1) {
      const slice = tokens.slice(index, index + windowSize);
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (!isSignificantEnglishToken(first) || !isSignificantEnglishToken(last)) continue;
      phrases.push(slice.join(' '));
    }
  }

  return Array.from(new Set(phrases));
}

function addTrailingWordInflectionTerms(target: Set<string>, value: string): void {
  const match = /^(.*[\s-])([a-z]+)$/iu.exec(value);
  if (!match) return;
  const [, prefix, word] = match;
  const singular = singularizeRegularWord(word);
  if (singular) addRecallTerm(target, `${prefix}${singular}`);
  const plural = pluralizeRegularWord(word);
  if (plural) addRecallTerm(target, `${prefix}${plural}`);
}

function dottedAcronym(rawValue: string): string | null {
  const raw = rawValue.normalize('NFKC').trim();
  if (!/^[A-Z]{2,5}$/u.test(raw)) return null;
  return `${Array.from(raw.toLowerCase()).join('.')}.`;
}

function undotAcronym(rawValue: string): string | null {
  const raw = rawValue.normalize('NFKC').trim();
  if (!/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) return null;
  return raw.replace(/\./g, '').toLowerCase();
}

function pluralizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 3) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
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
