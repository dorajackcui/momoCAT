export type TMTextProfile = 'default' | 'english';

const MAX_ENGLISH_TM_RECALL_TERMS = 32;
const WORD_RE = /[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu;
const LETTER_RE = /\p{L}/u;
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

export function hasEnglishTMConcordanceEvidence(queryText: string, candidateText: string): boolean {
  const query = normalizeTextForTMSimilarity(queryText, 'english');
  const candidate = normalizeTextForTMSimilarity(candidateText, 'english');
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;

  if (queryTokens.length === 1 || candidateTokens.length === 1) {
    return (
      queryTokens.length === 1 &&
      candidateTokens.length === 1 &&
      queryTokens[0] === candidateTokens[0] &&
      isSignificantEnglishToken(queryTokens[0])
    );
  }

  const queryPhrases = buildSignificantEnglishPhrases(queryTokens);
  const candidatePhrases = buildSignificantEnglishPhrases(candidateTokens);

  if (candidatePhrases.some((phrase) => containsCanonicalPhrase(query, phrase))) return true;
  if (queryPhrases.some((phrase) => containsCanonicalPhrase(candidate, phrase))) return true;

  const overlap = longestCommonTokenRun(queryTokens, candidateTokens);
  if (overlap < 2) return false;

  const candidateCoverage = overlap / candidateTokens.length;
  const queryCoverage = overlap / queryTokens.length;
  return candidateCoverage >= 0.9 && queryCoverage < 0.9;
}

function addRecallTerm(target: Set<string>, value: string | null): void {
  const term = value?.trim();
  if (!term || target.size >= MAX_ENGLISH_TM_RECALL_TERMS) return;
  if (term.length < 3 && !/^[a-z]{2,5}$/i.test(term)) return;
  target.add(term.toLowerCase());
}

function isSignificantEnglishToken(token: string): boolean {
  return token.length >= 3 && !ENGLISH_STOPWORDS.has(token) && LETTER_RE.test(token);
}

function containsCanonicalPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
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

function longestCommonTokenRun(a: string[], b: string[]): number {
  let best = 0;
  let previous = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      best = Math.max(best, current[j]);
    }
    previous = current;
  }

  return best;
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
  if (/[^aeiou]ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/zzes$/i.test(value)) return value.slice(0, -3);
  if (/(ches|shes|xes|zes)$/i.test(value)) return value.slice(0, -2);
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/^(buses|gases)$/i.test(value)) return value.slice(0, -2);
  if (/ses$/i.test(value)) return value.slice(0, -1);
  if (!/(ss|us|is)$/i.test(value) && /s$/i.test(value)) return value.slice(0, -1);
  return null;
}
