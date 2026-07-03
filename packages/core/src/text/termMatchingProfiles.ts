import {
  buildTermSearchPlan,
  findTermPositionsInText,
  normalizeTermForLookup,
  type TermMatchPosition,
  type TermSearchFragmentOptions,
  type TermSearchOptions,
  type TermSearchPlan,
} from './termMatching';

const CJK_LIKE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_RE = /\p{L}/u;
const WORD_RE = /[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu;
const LATIN_LETTER_RE = /[a-z]/i;
const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const MAX_ALIAS_TERMS = 24;
const MAX_ENGLISH_SEARCH_EXACT_TERMS = 128;
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

function isEnglishLocale(locale?: string): boolean {
  return locale?.toLowerCase() === 'en' || locale?.toLowerCase().startsWith('en-') || false;
}

function hasCjkLikeScript(value: string): boolean {
  return CJK_LIKE_RE.test(value);
}

function addAlias(target: Set<string>, value: string, maxAliases = MAX_ALIAS_TERMS): void {
  const alias = value.trim();
  if (alias.length < 2 || target.size >= maxAliases) return;
  target.add(alias);
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

  if (/[^aeiou]ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/zzes$/i.test(value)) return value.slice(0, -3);
  if (/(ches|shes|xes|zes)$/i.test(value)) return value.slice(0, -2);
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/^(buses|gases)$/i.test(value)) return value.slice(0, -2);
  if (/ses$/i.test(value)) return value.slice(0, -1);
  if (!/(ss|us|is)$/i.test(value) && /s$/i.test(value)) return value.slice(0, -1);
  return null;
}

function undottedAcronymLettersFromRaw(value: string): string | null {
  const raw = value.normalize('NFKC').trim();
  if (!/^[A-Z]{2,5}$/u.test(raw)) return null;
  return raw.toLowerCase();
}

function dottedAcronymLettersFromRaw(value: string): string | null {
  const raw = value.normalize('NFKC').trim();
  if (!/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) return null;
  return raw.replace(/\./g, '').toLowerCase();
}

function dottedAcronym(value: string, rawValue: string): string | null {
  const letters = undottedAcronymLettersFromRaw(rawValue);
  if (!letters || letters !== value) return null;
  return `${Array.from(value).join('.')}.`;
}

function undotAcronym(value: string, rawValue: string): string | null {
  const letters = dottedAcronymLettersFromRaw(rawValue);
  if (!letters || letters !== value.replace(/\./g, '').toLowerCase()) return null;
  return letters;
}

function addEnglishAliases(
  target: Set<string>,
  value: string,
  options?: {
    includePossessive?: boolean;
    includeUndottedAcronym?: boolean;
    maxAliases?: number;
  },
): void {
  const normalized = normalizeTermForLookup(value, { locale: 'en-US' });
  if (!LATIN_LETTER_RE.test(normalized)) return;
  const maxAliases = options?.maxAliases ?? MAX_ALIAS_TERMS;

  addAlias(target, normalized, maxAliases);

  const delimiterVariants: string[] = [];
  if (normalized.includes('-')) delimiterVariants.push(normalized.replace(/-/g, ' '));
  if (normalized.includes(' ')) delimiterVariants.push(normalized.replace(/\s+/g, '-'));
  for (const variant of delimiterVariants) {
    addAlias(target, variant, maxAliases);
  }

  addTrailingWordInflectionAliases(target, normalized, maxAliases);
  for (const variant of delimiterVariants) {
    addTrailingWordInflectionAliases(target, variant, maxAliases);
  }

  const undotted =
    options?.includeUndottedAcronym === false ? null : undotAcronym(normalized, value);
  if (undotted) addAlias(target, undotted, maxAliases);

  const dotted = dottedAcronym(normalized, value);
  if (dotted) addAlias(target, dotted, maxAliases);

  const singular = singularizeRegularWord(normalized);
  if (singular) addAlias(target, singular, maxAliases);

  const plural = singular ? null : pluralizeRegularWord(normalized);
  if (plural) addAlias(target, plural, maxAliases);

  if ((options?.includePossessive ?? true) && !normalized.includes("'")) {
    addAlias(target, normalized.endsWith('s') ? `${normalized}'` : `${normalized}'s`, maxAliases);
  }
}

function addTrailingWordInflectionAliases(
  target: Set<string>,
  value: string,
  maxAliases = MAX_ALIAS_TERMS,
): void {
  const match = /^(.*[\s-])([a-z]+)$/iu.exec(value);
  if (!match) return;

  const [, prefix, word] = match;
  const singular = singularizeRegularWord(word);
  if (singular) {
    addAlias(target, `${prefix}${singular}`, maxAliases);
    return;
  }

  const plural = pluralizeRegularWord(word);
  if (plural) addAlias(target, `${prefix}${plural}`, maxAliases);
}

function buildEnglishWholeTermAliases(
  value: string,
  options?: { includePossessive?: boolean; includeUndottedAcronym?: boolean },
): string[] {
  const aliases = new Set<string>();
  addEnglishAliases(aliases, value, options);
  return Array.from(aliases);
}

function isEnglishStopword(value: string): boolean {
  return ENGLISH_STOPWORDS.has(value.toLowerCase());
}

function stripEnglishPossessive(value: string): string {
  return value.replace(/(?:'s|s')$/iu, '');
}

function compactEnglishLetters(value: string): string {
  return value.replace(/[^a-z0-9]+/giu, '').toLowerCase();
}

function isEnglishAcronymLikeRaw(value: string): boolean {
  return Boolean(undottedAcronymLettersFromRaw(value) || dottedAcronymLettersFromRaw(value));
}

function isSignificantEnglishLookupTerm(value: string, rawValue?: string): boolean {
  const compact = compactEnglishLetters(stripEnglishPossessive(value));
  if (!compact || isEnglishStopword(compact)) return false;
  if (compact.length >= 3) return true;
  return rawValue ? isEnglishAcronymLikeRaw(rawValue) : false;
}

function addSearchAlias(target: Set<string>, value: string): void {
  addAlias(target, value, MAX_ENGLISH_SEARCH_EXACT_TERMS);
}

function addEnglishSearchTokenAliases(target: Set<string>, rawValue: string): void {
  const normalized = normalizeTermForLookup(rawValue, { locale: 'en-US' });
  const base = stripEnglishPossessive(normalized);
  const values = normalized === base ? [base] : [base, normalized];
  const undotted = undotAcronym(normalized, rawValue);
  const dotted = dottedAcronym(normalized, rawValue);

  if (undotted) addSearchAlias(target, undotted);
  if (dotted) addSearchAlias(target, dotted);

  for (const value of values) {
    if (!isSignificantEnglishLookupTerm(value, rawValue)) continue;
    addEnglishAliases(target, value, {
      includePossessive: true,
      maxAliases: MAX_ENGLISH_SEARCH_EXACT_TERMS,
    });
  }
}

function tokenizeEnglishPhraseWords(value: string): string[] {
  const words: string[] = [];

  for (const match of value.normalize('NFKC').matchAll(WORD_RE)) {
    const normalized = stripEnglishPossessive(
      normalizeTermForLookup(match[0], { locale: 'en-US' }),
    );
    for (const word of normalized.split(/[.\s-]+/u)) {
      if (word.length > 0) words.push(word);
    }
  }

  return words;
}

function countSignificantEnglishWords(words: string[]): number {
  return words.filter((word) => isSignificantEnglishLookupTerm(word)).length;
}

function buildDelimiterPhraseVariants(words: string[]): string[] {
  const variants = new Set<string>([words.join(' ')]);

  for (let index = 0; index < words.length - 1; index += 1) {
    const parts: string[] = [];
    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      parts.push(words[wordIndex]);
      if (wordIndex < words.length - 1) {
        parts.push(wordIndex === index ? '-' : ' ');
      }
    }
    variants.add(parts.join(''));
  }

  if (words.length > 2) {
    variants.add(words.join('-'));
  }

  return Array.from(variants);
}

const ENGLISH_ARTICLES = new Set(['the', 'a', 'an']);

function isEnglishArticle(word: string): boolean {
  return ENGLISH_ARTICLES.has(word.toLowerCase());
}

function addEnglishSearchPhraseAliases(target: Set<string>, value: string): void {
  const words = tokenizeEnglishPhraseWords(value);

  for (let size = 2; size <= 4; size += 1) {
    for (let start = 0; start <= words.length - size; start += 1) {
      const slice = words.slice(start, start + size);
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (isEnglishStopword(first) || isEnglishStopword(last)) continue;
      if (countSignificantEnglishWords(slice) < 2) continue;

      for (const phrase of buildDelimiterPhraseVariants(slice)) {
        addSearchAlias(target, phrase);
        addTrailingWordInflectionAliases(target, phrase, MAX_ENGLISH_SEARCH_EXACT_TERMS);
      }

      if (start > 0 && isEnglishArticle(words[start - 1])) {
        const prefixed = [words[start - 1], ...slice];
        for (const phrase of buildDelimiterPhraseVariants(prefixed)) {
          addSearchAlias(target, phrase);
          addTrailingWordInflectionAliases(target, phrase, MAX_ENGLISH_SEARCH_EXACT_TERMS);
        }
      }
    }
  }

  for (let i = 0; i < words.length - 1; i += 1) {
    if (!isEnglishArticle(words[i])) continue;
    const next = words[i + 1];
    if (isEnglishStopword(next) || next.length < 3) continue;
    addSearchAlias(target, `${words[i]} ${next}`);
    addTrailingWordInflectionAliases(target, `${words[i]} ${next}`, MAX_ENGLISH_SEARCH_EXACT_TERMS);
  }
}

function buildEnglishSearchExactLookupTerms(value: string, strictPlan: TermSearchPlan): string[] {
  const terms = new Set<string>();

  for (const term of strictPlan.exactLookupTerms) {
    if (isEnglishStopword(compactEnglishLetters(term))) continue;
    if (term.trim().length >= 2) terms.add(term.trim());
  }

  for (const match of value.normalize('NFKC').matchAll(WORD_RE)) {
    addEnglishSearchTokenAliases(terms, match[0]);
  }

  addEnglishSearchPhraseAliases(terms, value);

  return Array.from(terms);
}

function shouldKeepEnglishFtsFragment(fragment: string): boolean {
  const words = fragment.split(/\s+/u).filter(Boolean);
  if (words.length === 1) {
    return !isEnglishStopword(words[0]) && words[0].length >= 4;
  }
  if (isEnglishStopword(words[0]) || isEnglishStopword(words[words.length - 1])) return false;
  return countSignificantEnglishWords(words) >= 2;
}

function filterEnglishFtsFragments(fragments: string[]): string[] {
  return fragments.filter(shouldKeepEnglishFtsFragment);
}

export function buildTermSearchPlanForLocale(
  value: string,
  options?: TermSearchFragmentOptions,
): TermSearchPlan {
  const strictPlan = buildTermSearchPlan(value, options);
  if (!isEnglishLocale(options?.locale)) return strictPlan;

  return {
    ftsFragments: filterEnglishFtsFragments(strictPlan.ftsFragments),
    exactLookupTerms: buildEnglishSearchExactLookupTerms(value, strictPlan),
  };
}

export function findTermPositionsInTextForLocale(
  text: string,
  term: string,
  options?: TermSearchOptions,
): TermMatchPosition[] {
  const strictPositions = findTermPositionsInText(text, term, options);
  if (strictPositions.length > 0) return strictPositions;
  if (!isEnglishLocale(options?.locale) || hasCjkLikeScript(term)) {
    return [];
  }

  for (const alias of buildEnglishWholeTermAliases(term, { includeUndottedAcronym: false })) {
    if (alias === normalizeTermForLookup(term, options)) continue;
    const positions = findTermPositionsInText(text, alias, options);
    if (positions.length > 0) return positions;
  }

  const acronymPositions = findUndottedAcronymPositions(text, term);
  if (acronymPositions.length > 0) return acronymPositions;

  return [];
}

function findUndottedAcronymPositions(text: string, term: string): TermMatchPosition[] {
  const letters = dottedAcronymLettersFromRaw(term);
  if (!letters) return [];

  const positions: TermMatchPosition[] = [];
  const acronym = letters.toUpperCase();

  for (let index = text.indexOf(acronym); index >= 0; index = text.indexOf(acronym, index + 1)) {
    const before = index > 0 ? text[index - 1] : '';
    const after = index + acronym.length < text.length ? text[index + acronym.length] : '';
    if (LETTER_OR_NUMBER_RE.test(before) || LETTER_OR_NUMBER_RE.test(after)) continue;
    positions.push({ start: index, end: index + acronym.length });
  }

  return positions;
}
