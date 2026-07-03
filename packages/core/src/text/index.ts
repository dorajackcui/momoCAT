export {
  buildTermSearchPlan,
  buildTermSearchFragments,
  findTermPositionsInText,
  normalizeTermForLookup,
  suppressNestedTermMatches,
  type TermMatchPosition,
  type TermNormalizationOptions,
  type TermSearchFragmentOptions,
  type TermSearchPlan,
  type TermSearchOptions,
} from './termMatching';
export {
  buildTermSearchPlanForLocale,
  findTermPositionsInTextForLocale,
} from './termMatchingProfiles';
export {
  buildEnglishTMConcordancePhraseTerms,
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  resolveTMTextProfile,
  type EnglishTMConcordancePhraseTerms,
  type TMTextProfile,
} from './tmMatchingProfiles';
export {
  isCjkSourceRecallProfile,
  resolveSourceRecallProfile,
  type SourceRecallProfile,
} from './sourceRecallProfile';
export {
  computeMatchKey,
  computeSrcHash,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  serializeTokensToTextOnly,
  type SearchTextWithBoundaries,
} from './tokenText';
