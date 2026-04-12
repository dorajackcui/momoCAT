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
  computeMatchKey,
  computeSrcHash,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToTextOnly,
} from './tokenText';
