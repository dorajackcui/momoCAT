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
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  resolveTMTextProfile,
  type TMTextProfile,
} from './tmMatchingProfiles';
export {
  computeMatchKey,
  computeSrcHash,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToTextOnly,
} from './tokenText';
