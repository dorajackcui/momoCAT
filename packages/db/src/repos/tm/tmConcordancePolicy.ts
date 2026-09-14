import { buildEnglishTMConcordancePhraseTerms, buildEnglishTMRecallTerms } from '@cat/core/text';
import type { TMRecallDbRow } from './tmEntryRows';
import {
  buildCjkWindows,
  extractCjkComponents,
  extractSearchTerms,
  selectSpreadFragments,
  uniqueTerms,
  ONLY_CJK_RE,
  WEAK_SHORT_CJK_TERMS,
} from './tmRecallQuery';
import { findLongestCommonSubstring, normalizeForOverlap } from './tmRecallDiversity';

export interface TMConcordanceRecallQueryPlan {
  cjk4Fragments: string[];
  cjk3Fragments: string[];
  longCjkFragments: string[];
  latinTerms: string[];
  shortCjkTerms: string[];
  englishExactPhrases: string[];
  englishFtsPhrases: string[];
  englishTerms: string[];
}

const TM_CONCORDANCE_RECALL_CJK4_LIMIT = 64;
const TM_CONCORDANCE_RECALL_CJK3_LIMIT = 48;
const TM_CONCORDANCE_RECALL_CJK_LONG_LIMIT = 32;
const TM_CONCORDANCE_RECALL_LATIN_LIMIT = 32;
const TM_CONCORDANCE_RECALL_SHORT_CJK_LIMIT = 16;

export function buildTMConcordanceRecallQueryPlan(
  queryText: string,
  profile?: 'english',
): TMConcordanceRecallQueryPlan {
  const terms = extractSearchTerms(queryText);
  const cjkComponents = uniqueTerms(terms.flatMap((term) => extractCjkComponents(term)));
  const cjk3 = cjkComponents.flatMap((component) => buildCjkWindows(component, 3));
  const cjk4 = cjkComponents.flatMap((component) => buildCjkWindows(component, 4));
  const cjk5 = cjkComponents.flatMap((component) => buildCjkWindows(component, 5));
  const cjk6 = cjkComponents.flatMap((component) => buildCjkWindows(component, 6));
  const cjk2 = cjkComponents.flatMap((component) => buildCjkWindows(component, 2));
  const englishPhraseTerms =
    profile === 'english'
      ? buildEnglishTMConcordancePhraseTerms(queryText)
      : { exactPhrases: [], ftsPhrases: [] };
  const englishTerms =
    profile === 'english' ? selectSpreadFragments(buildEnglishTMRecallTerms(queryText), 32) : [];

  return {
    cjk4Fragments: selectSpreadFragments(uniqueTerms(cjk4), TM_CONCORDANCE_RECALL_CJK4_LIMIT),
    cjk3Fragments: selectSpreadFragments(uniqueTerms(cjk3), TM_CONCORDANCE_RECALL_CJK3_LIMIT),
    longCjkFragments: selectSpreadFragments(
      uniqueTerms([...cjk5, ...cjk6]),
      TM_CONCORDANCE_RECALL_CJK_LONG_LIMIT,
    ),
    latinTerms: selectSpreadFragments(
      uniqueTerms(terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term))),
      TM_CONCORDANCE_RECALL_LATIN_LIMIT,
    ),
    shortCjkTerms: selectSpreadFragments(
      uniqueTerms(cjk2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
      TM_CONCORDANCE_RECALL_SHORT_CJK_LIMIT,
    ),
    englishExactPhrases: uniqueTerms(englishPhraseTerms.exactPhrases),
    englishFtsPhrases: uniqueTerms(englishPhraseTerms.ftsPhrases),
    englishTerms,
  };
}

export function hasConcordanceRecallEvidence(queryText: string, row: TMRecallDbRow): boolean {
  const normalizedQuery = normalizeForOverlap(queryText);
  const normalizedCandidate = normalizeForOverlap(row.ftsSrcText);
  const candidateChars = Array.from(normalizedCandidate);
  if (candidateChars.length === 0) return false;

  const overlap = findLongestCommonSubstring(normalizedQuery, normalizedCandidate);
  const overlapLength = Array.from(overlap).length;
  const candidateCjkLength = Array.from(
    normalizedCandidate.replace(/[^\u4e00-\u9fa5]/g, ''),
  ).length;

  if (
    isCjkWithBoundarySpaces(normalizedCandidate) &&
    candidateCjkLength >= 3 &&
    candidateCjkLength <= 8 &&
    containsWithTokenBoundary(normalizedQuery, normalizedCandidate)
  ) {
    return true;
  }

  if (
    isCjkWithBoundarySpaces(normalizedCandidate) &&
    candidateCjkLength === 2 &&
    getTotalCjkComponentLength(normalizedCandidate) <= 4 &&
    containsWithTokenBoundary(normalizedQuery, normalizedCandidate)
  ) {
    return true;
  }

  if (overlapLength >= 3) {
    const entryCoverage = Math.round((overlapLength / candidateChars.length) * 100);
    if (entryCoverage >= 90) return true;
  }

  return overlapLength >= 4;
}

function containsWithTokenBoundary(normalizedQuery: string, normalizedCandidate: string): boolean {
  return normalizedQuery.includes(normalizedCandidate);
}

function isCjkWithBoundarySpaces(text: string): boolean {
  return /^[\u4e00-\u9fa5 ]+$/.test(text);
}

function getTotalCjkComponentLength(text: string): number {
  return extractCjkComponents(text).reduce(
    (sum, component) => sum + Array.from(component).length,
    0,
  );
}
