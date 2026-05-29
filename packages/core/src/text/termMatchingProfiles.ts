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

function isEnglishLocale(locale?: string): boolean {
  return locale?.toLowerCase() === 'en' || locale?.toLowerCase().startsWith('en-') || false;
}

function hasCjkLikeScript(value: string): boolean {
  return CJK_LIKE_RE.test(value);
}

function addAlias(target: Set<string>, value: string): void {
  const alias = value.trim();
  if (alias.length < 2 || target.size >= MAX_ALIAS_TERMS) return;
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
  if (!letters || letters !== value.replace(/\./g, '')) return null;
  return letters;
}

function addEnglishAliases(
  target: Set<string>,
  value: string,
  options?: { includePossessive?: boolean; includeUndottedAcronym?: boolean },
): void {
  const normalized = normalizeTermForLookup(value, { locale: 'en-US' });
  if (!LATIN_LETTER_RE.test(normalized)) return;

  addAlias(target, normalized);

  const delimiterVariants: string[] = [];
  if (normalized.includes('-')) delimiterVariants.push(normalized.replace(/-/g, ' '));
  if (normalized.includes(' ')) delimiterVariants.push(normalized.replace(/\s+/g, '-'));
  for (const variant of delimiterVariants) {
    addAlias(target, variant);
  }

  addTrailingWordInflectionAliases(target, normalized);
  for (const variant of delimiterVariants) {
    addTrailingWordInflectionAliases(target, variant);
  }

  const undotted =
    options?.includeUndottedAcronym === false ? null : undotAcronym(normalized, value);
  if (undotted) addAlias(target, undotted);

  const dotted = dottedAcronym(normalized, value);
  if (dotted) addAlias(target, dotted);

  const singular = singularizeRegularWord(normalized);
  if (singular) addAlias(target, singular);

  const plural = singular ? null : pluralizeRegularWord(normalized);
  if (plural) addAlias(target, plural);

  if (options?.includePossessive ?? true) {
    if (!normalized.endsWith("'s")) addAlias(target, `${normalized}'s`);
    if (!normalized.endsWith("s'")) addAlias(target, `${normalized}s'`);
  }
}

function addTrailingWordInflectionAliases(target: Set<string>, value: string): void {
  const match = /^(.*[\s-])([a-z]+)$/iu.exec(value);
  if (!match) return;

  const [, prefix, word] = match;
  const singular = singularizeRegularWord(word);
  if (singular) {
    addAlias(target, `${prefix}${singular}`);
    return;
  }

  const plural = pluralizeRegularWord(word);
  if (plural) addAlias(target, `${prefix}${plural}`);
}

function buildEnglishAliases(
  value: string,
  options?: {
    includeWholeValue?: boolean;
    includePossessive?: boolean;
    includeUndottedAcronym?: boolean;
  },
): string[] {
  const aliases = new Set<string>();
  if (options?.includeWholeValue ?? true) {
    addEnglishAliases(aliases, value, options);
  }

  for (const match of value.normalize('NFKC').matchAll(WORD_RE)) {
    addEnglishAliases(aliases, match[0], options);
  }

  return Array.from(aliases);
}

function buildEnglishWholeTermAliases(
  value: string,
  options?: { includePossessive?: boolean; includeUndottedAcronym?: boolean },
): string[] {
  const aliases = new Set<string>();
  addEnglishAliases(aliases, value, options);
  return Array.from(aliases);
}

function mergeWithBoundedAdditions(
  primary: string[],
  additions: string[],
  maxAdditions: number,
): string[] {
  const merged = new Set(primary);
  let added = 0;

  for (const value of additions) {
    if (merged.has(value)) continue;
    if (added >= maxAdditions) break;
    merged.add(value);
    added += 1;
  }

  return Array.from(merged);
}

export function buildTermSearchPlanForLocale(
  value: string,
  options?: TermSearchFragmentOptions,
): TermSearchPlan {
  const strictPlan = buildTermSearchPlan(value, options);
  if (!isEnglishLocale(options?.locale)) return strictPlan;

  return {
    ftsFragments: strictPlan.ftsFragments,
    exactLookupTerms: mergeWithBoundedAdditions(
      strictPlan.exactLookupTerms,
      buildEnglishAliases(value, { includeWholeValue: false, includePossessive: false }),
      MAX_ALIAS_TERMS,
    ),
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
