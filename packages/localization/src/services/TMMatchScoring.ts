import { normalizeTextForTMSimilarity, serializeTokensToTextOnly } from '@cat/core/text';
import { distance } from 'fastest-levenshtein';
import type {
  LocalOverlapResult,
  RankedTMMatch,
  RankTMRecallCandidateParams,
  TMSourceMatchContext,
} from './TMMatchTypes';

const MIN_SIMILARITY = 50;
const LEVENSHTEIN_WEIGHT = 0.75;
const DICE_WEIGHT = 0.25;
const DIVERSITY_MIN_CJK_BUCKET_LENGTH = 4;
const LOCAL_OVERLAP_CONCORDANCE_MIN_SCORE = 80;
const LOCAL_OVERLAP_CONCORDANCE_MIN_ADVANTAGE = 15;
const LOCAL_OVERLAP_CONCORDANCE_MIN_ENTRY_COVERAGE = 90;
const LOCAL_OVERLAP_CONCORDANCE_MAX_SOURCE_COVERAGE = 75;
const ENGLISH_PHRASE_STOPWORDS = new Set([
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

const EMPTY_LOCAL_OVERLAP: LocalOverlapResult = {
  score: 0,
  matchedSourceText: '',
  sourceCoverage: 0,
  entryCoverage: 0,
};

export class TMMatchScorer {
  public createSourceContext(
    textOnly: string,
    profile: TMSourceMatchContext['profile'],
  ): TMSourceMatchContext {
    return {
      textOnly,
      normalized: this.normalizeForSimilarity(textOnly),
      profileNormalized: normalizeTextForTMSimilarity(textOnly, profile),
      profile,
    };
  }

  public rankRecallCandidate(params: RankTMRecallCandidateParams): RankedTMMatch | null {
    const { source, recall, tmName, tmType } = params;
    const candidateTextOnly = serializeTokensToTextOnly(recall.candidate.sourceTokens);
    const candidateNormalized = this.normalizeForSimilarity(candidateTextOnly);
    const candidateProfileNormalized = normalizeTextForTMSimilarity(
      candidateTextOnly,
      source.profile,
    );

    if (
      source.profile === 'english' &&
      this.shouldSuppressEnglishFuzzyOnlyPhraseSubmatch({
        sourceCanonical: source.profileNormalized,
        candidateCanonical: candidateProfileNormalized,
        fromFuzzy: recall.fromFuzzy,
        fromConcordance: recall.fromConcordance,
      })
    ) {
      return null;
    }

    const sourceLength = Array.from(source.normalized).length;
    const candidateLength = Array.from(candidateNormalized).length;
    if (!recall.fromFuzzy && recall.fromConcordance && candidateLength > sourceLength * 3) {
      return null;
    }

    let standardSimilarity = 0;
    let localOverlap = { ...EMPTY_LOCAL_OVERLAP };

    if (source.normalized === candidateNormalized) {
      standardSimilarity = 99;
    } else {
      localOverlap = this.computeLocalOverlapSimilarity(source.normalized, candidateNormalized);
      if (recall.fromConcordance) {
        localOverlap = this.promoteContainedConcordanceOverlap(localOverlap);
      }
      if (this.computeMaxLengthBound(source.normalized, candidateNormalized) >= MIN_SIMILARITY) {
        standardSimilarity = this.computeWeightedStandardSimilarity(
          source.normalized,
          candidateNormalized,
        );
      }
    }

    if (source.profile === 'english') {
      const hasAcronymCollision = this.hasOneSidedShortAcronymCollision(
        source.textOnly,
        candidateTextOnly,
        source.profileNormalized,
        candidateProfileNormalized,
      );
      if (hasAcronymCollision) {
        standardSimilarity = 0;
        localOverlap = { ...EMPTY_LOCAL_OVERLAP };
      } else if (source.profileNormalized === candidateProfileNormalized) {
        standardSimilarity = Math.max(
          standardSimilarity,
          this.computeEnglishExactCanonicalSimilarity(
            source.textOnly,
            candidateTextOnly,
            source.profileNormalized,
          ),
        );
      } else {
        standardSimilarity = Math.max(
          standardSimilarity,
          this.computeProfileStandardSimilarity(
            source.profileNormalized,
            candidateProfileNormalized,
          ),
        );
      }
    }

    const diversityBucket =
      source.normalized === candidateNormalized
        ? this.getExactNormalizedDiversityBucket(source.normalized)
        : this.getLocalOverlapDiversityBucket(localOverlap);
    const baseMatch = {
      ...recall.candidate,
      tmName,
      tmType,
    } as const;

    if (this.shouldClassifyLocalOverlapAsConcordance(standardSimilarity, localOverlap)) {
      return {
        match: this.createConcordanceMatch(baseMatch, localOverlap),
        diversityBucket,
      };
    }

    if (standardSimilarity >= MIN_SIMILARITY) {
      return {
        match: {
          ...baseMatch,
          kind: 'tm',
          similarity: standardSimilarity,
          rank: standardSimilarity,
        },
        diversityBucket,
      };
    }

    if (localOverlap.score >= MIN_SIMILARITY) {
      return {
        match: this.createConcordanceMatch(baseMatch, localOverlap),
        diversityBucket,
      };
    }

    return null;
  }

  public normalizeForSimilarity(text: string): string {
    return normalizeTextForTMSimilarity(text, 'default');
  }

  public computeMaxLengthBound(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    return Math.floor((1 - Math.abs(a.length - b.length) / maxLen) * 100);
  }

  public computeLevenshteinSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    const levDist = distance(a, b);
    return Math.max(0, Math.round((1 - levDist / maxLen) * 100));
  }

  public computeDiceSimilarity(a: string, b: string): number {
    if (!a && !b) return 100;
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.length < 2 || b.length < 2) return 0;

    const aBigrams = this.buildBigramCounts(a);
    const bBigrams = this.buildBigramCounts(b);
    const aCount = Array.from(aBigrams.values()).reduce((total, count) => total + count, 0);
    const bCount = Array.from(bBigrams.values()).reduce((total, count) => total + count, 0);
    let overlap = 0;

    for (const [gram, aGramCount] of aBigrams.entries()) {
      overlap += Math.min(aGramCount, bBigrams.get(gram) ?? 0);
    }

    if (aCount + bCount === 0) return 0;
    return Math.round(((2 * overlap) / (aCount + bCount)) * 100);
  }

  public computeSimilarityBonus(a: string, b: string): number {
    const shorterLen = Math.min(a.length, b.length);
    let bonus = 0;

    if (shorterLen >= 6 && (a.includes(b) || b.includes(a))) {
      bonus += 4;
    }

    const prefixLength = Math.min(4, shorterLen);
    if (prefixLength > 0 && a.slice(0, prefixLength) === b.slice(0, prefixLength)) {
      bonus += 2;
    }

    return bonus;
  }

  public computeLocalOverlapSimilarity(a: string, b: string): LocalOverlapResult {
    const longest = this.findLongestCommonSubstring(a, b);
    const overlapLength = Array.from(longest).length;
    if (overlapLength < 2) return { ...EMPTY_LOCAL_OVERLAP };

    const aLength = Array.from(a).length;
    const bLength = Array.from(b).length;
    const shorterLength = Math.min(aLength, bLength);
    const longerLength = Math.max(aLength, bLength);
    if (shorterLength === 0 || longerLength === 0) return { ...EMPTY_LOCAL_OVERLAP };

    const shorterCoverage = overlapLength / shorterLength;
    const longerCoverage = overlapLength / longerLength;
    let score = Math.round(shorterCoverage * 70 + longerCoverage * 30);
    const hasSharedComponent = this.hasSharedCjkComponent(a, b);

    if (!hasSharedComponent && longerCoverage < 0.45) {
      score = Math.min(score, MIN_SIMILARITY - 1);
    }
    if (hasSharedComponent) {
      score = Math.max(score, MIN_SIMILARITY);
    }

    return {
      score: Math.min(99, score),
      matchedSourceText: longest,
      sourceCoverage: Math.round((overlapLength / aLength) * 100),
      entryCoverage: Math.round((overlapLength / bLength) * 100),
    };
  }

  public promoteContainedConcordanceOverlap(localOverlap: LocalOverlapResult): LocalOverlapResult {
    const overlapLength = Array.from(localOverlap.matchedSourceText).length;
    if (overlapLength < 3) return localOverlap;
    if (localOverlap.entryCoverage < 90) return localOverlap;
    if (localOverlap.score >= MIN_SIMILARITY) return localOverlap;
    return { ...localOverlap, score: MIN_SIMILARITY };
  }

  public shouldClassifyLocalOverlapAsConcordance(
    standardSimilarity: number,
    localOverlap: LocalOverlapResult,
  ): boolean {
    if (standardSimilarity < MIN_SIMILARITY) return false;
    if (localOverlap.score < LOCAL_OVERLAP_CONCORDANCE_MIN_SCORE) return false;
    if (localOverlap.score - standardSimilarity < LOCAL_OVERLAP_CONCORDANCE_MIN_ADVANTAGE) {
      return false;
    }
    if (localOverlap.entryCoverage < LOCAL_OVERLAP_CONCORDANCE_MIN_ENTRY_COVERAGE) {
      return false;
    }
    return localOverlap.sourceCoverage < LOCAL_OVERLAP_CONCORDANCE_MAX_SOURCE_COVERAGE;
  }

  public getLocalOverlapDiversityBucket(localOverlap: LocalOverlapResult): string | null {
    const fragment = localOverlap.matchedSourceText.trim();
    if (!this.isStrongCjkDiversityBucket(fragment)) return null;
    return fragment;
  }

  public getExactNormalizedDiversityBucket(normalizedText: string): string | null {
    const cjkComponents = this.extractCjkComponents(normalizedText)
      .filter((component) => this.isStrongCjkDiversityBucket(component))
      .sort((a, b) => Array.from(b).length - Array.from(a).length);
    return cjkComponents[0] ?? null;
  }

  private createConcordanceMatch(
    baseMatch: RankTMRecallCandidateParams['recall']['candidate'] & {
      tmName: string;
      tmType: 'working' | 'main';
    },
    localOverlap: LocalOverlapResult,
  ): RankedTMMatch['match'] {
    return {
      ...baseMatch,
      kind: 'concordance',
      rank: localOverlap.score,
      matchedSourceText: localOverlap.matchedSourceText,
      sourceCoverage: localOverlap.sourceCoverage,
      entryCoverage: localOverlap.entryCoverage,
    };
  }

  private shouldSuppressEnglishFuzzyOnlyPhraseSubmatch(params: {
    sourceCanonical: string;
    candidateCanonical: string;
    fromFuzzy: boolean;
    fromConcordance: boolean;
  }): boolean {
    if (!params.fromFuzzy || params.fromConcordance) return false;
    if (params.sourceCanonical === params.candidateCanonical) return false;
    const significantTokenCount = params.candidateCanonical
      .split(/\s+/)
      .filter((token) => this.isSignificantEnglishToken(token)).length;
    if (significantTokenCount === 0) return true;
    if (significantTokenCount > 4) return false;
    return !` ${params.sourceCanonical} `.includes(` ${params.candidateCanonical} `);
  }

  private isSignificantEnglishToken(token: string): boolean {
    return token.length >= 2 && /[a-z]/u.test(token) && !ENGLISH_PHRASE_STOPWORDS.has(token);
  }

  private computeProfileStandardSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (this.computeMaxLengthBound(a, b) < MIN_SIMILARITY) return 0;
    return this.computeWeightedStandardSimilarity(a, b);
  }

  private computeEnglishExactCanonicalSimilarity(
    sourceText: string,
    candidateText: string,
    canonical: string,
  ): number {
    if (!canonical) return 0;
    const shortLetterTokens = this.getShortLetterCanonicalTokens(canonical);
    if (shortLetterTokens.length === 0) return 99;

    for (const token of shortLetterTokens) {
      const sourceHasAcronym = this.hasRawAcronymRepresentation(sourceText, token);
      const candidateHasAcronym = this.hasRawAcronymRepresentation(candidateText, token);
      if (!sourceHasAcronym && !candidateHasAcronym) continue;
      if (!sourceHasAcronym || !candidateHasAcronym) return 0;
    }
    return 99;
  }

  private hasOneSidedShortAcronymCollision(
    sourceText: string,
    candidateText: string,
    sourceCanonical: string,
    candidateCanonical: string,
  ): boolean {
    const sourceTokens = new Set(this.getShortLetterCanonicalTokens(sourceCanonical));
    const candidateTokens = new Set(this.getShortLetterCanonicalTokens(candidateCanonical));
    for (const token of sourceTokens) {
      if (!candidateTokens.has(token)) continue;
      const sourceHasAcronym = this.hasRawAcronymRepresentation(sourceText, token);
      const candidateHasAcronym = this.hasRawAcronymRepresentation(candidateText, token);
      if (sourceHasAcronym !== candidateHasAcronym) return true;
    }
    return false;
  }

  private getShortLetterCanonicalTokens(canonical: string): string[] {
    return canonical.split(/\s+/).filter((token) => /^[a-z]{1,2}$/u.test(token));
  }

  private hasRawAcronymRepresentation(text: string, canonical: string): boolean {
    const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu) ?? [];
    return tokens.some((token) => {
      if (!this.isUppercaseAcronymShape(token)) return false;
      return token.replace(/\./g, '').toLowerCase() === canonical;
    });
  }

  private isUppercaseAcronymShape(token: string): boolean {
    return /^[A-Z]{2,5}$/u.test(token) || /^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(token);
  }

  private computeWeightedStandardSimilarity(a: string, b: string): number {
    const levSimilarity = this.computeLevenshteinSimilarity(a, b);
    const diceSimilarity = this.computeDiceSimilarity(a, b);
    const bonus = this.computeSimilarityBonus(a, b);
    return Math.min(
      99,
      Math.round(levSimilarity * LEVENSHTEIN_WEIGHT + diceSimilarity * DICE_WEIGHT + bonus),
    );
  }

  private buildBigramCounts(text: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const gram = text.slice(i, i + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  }

  private isStrongCjkDiversityBucket(fragment: string): boolean {
    return (
      /^[\u4e00-\u9fa5]+$/.test(fragment) &&
      Array.from(fragment).length >= DIVERSITY_MIN_CJK_BUCKET_LENGTH
    );
  }

  private findLongestCommonSubstring(a: string, b: string): string {
    const aChars = Array.from(a);
    const bChars = Array.from(b);
    let previous = new Array(bChars.length + 1).fill(0);
    let bestLength = 0;
    let bestEnd = 0;

    for (let i = 1; i <= aChars.length; i += 1) {
      const current = new Array(bChars.length + 1).fill(0);
      for (let j = 1; j <= bChars.length; j += 1) {
        if (aChars[i - 1] !== bChars[j - 1]) continue;
        current[j] = previous[j - 1] + 1;
        if (current[j] > bestLength) {
          bestLength = current[j];
          bestEnd = i;
        }
      }
      previous = current;
    }
    return aChars.slice(bestEnd - bestLength, bestEnd).join('');
  }

  private hasSharedCjkComponent(a: string, b: string): boolean {
    const aComponents = this.extractCjkComponents(a);
    const bComponents = new Set(this.extractCjkComponents(b));
    return aComponents.some((component) => bComponents.has(component));
  }

  private extractCjkComponents(text: string): string[] {
    return text
      .split(/[^\u4e00-\u9fa5]+/g)
      .map((component) => component.trim())
      .filter((component) => component.length >= 2);
  }
}
