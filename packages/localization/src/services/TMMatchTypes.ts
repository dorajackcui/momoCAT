import type { TMEntry } from '@cat/core/models';
import type { TMTextProfile } from '@cat/core/text';

export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;

export interface LocalOverlapResult {
  score: number;
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export interface RankedTMMatch {
  match: TMMatch;
  diversityBucket: string | null;
}

export interface TMRecallCandidate {
  candidate: TMEntry & { tmId: string };
  fromFuzzy: boolean;
  fromConcordance: boolean;
}

export interface TMSourceMatchContext {
  textOnly: string;
  normalized: string;
  profileNormalized: string;
  profile: TMTextProfile;
}

export interface RankTMRecallCandidateParams {
  source: TMSourceMatchContext;
  recall: TMRecallCandidate;
  tmName: string;
  tmType: 'working' | 'main';
}
