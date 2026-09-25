import { describe, expect, it, vi } from 'vitest';
import { createTransientSegment } from '../transientSegment';
import { TMMatchScorer } from './TMMatchScoring';
import type { RankTMRecallCandidateParams, TMSourceMatchContext } from './TMMatchTypes';

function params(
  scorer: TMMatchScorer,
  source: string,
  candidate: string,
  profile: TMSourceMatchContext['profile'] = 'english',
  recall = { fromFuzzy: true, fromConcordance: false },
): RankTMRecallCandidateParams {
  const segment = createTransientSegment({ id: 'entry', source: candidate, target: '译文' }, 0);
  return {
    source: scorer.createSourceContext(source, profile),
    recall: {
      ...recall,
      candidate: {
        id: 'entry',
        tmId: 'tm',
        projectId: 1,
        srcLang: 'en',
        tgtLang: 'zh',
        srcHash: segment.srcHash,
        matchKey: segment.matchKey,
        tagsSignature: segment.tagsSignature,
        sourceTokens: segment.sourceTokens,
        targetTokens: segment.targetTokens,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        usageCount: 1,
      },
    },
    tmName: 'TM',
    tmType: 'main',
  };
}

describe('TM scoring work reuse', () => {
  it('scores an unchanged English input pair once without changing rank', () => {
    const scorer = new TMMatchScorer();
    const levenshtein = vi.spyOn(scorer, 'computeLevenshteinSimilarity');
    const dice = vi.spyOn(scorer, 'computeDiceSimilarity');

    expect(
      scorer.rankRecallCandidate(
        params(
          scorer,
          'configure the remote service in this secure workspace',
          'configure the local service in this secure workspace',
        ),
      ),
    ).toMatchObject({ match: { kind: 'tm', similarity: 91, rank: 91 }, diversityBucket: null });
    expect(levenshtein).toHaveBeenCalledTimes(1);
    expect(dice).toHaveBeenCalledTimes(1);
  });

  it('still scores both pairs when English normalization changes the input', () => {
    const scorer = new TMMatchScorer();
    const levenshtein = vi.spyOn(scorer, 'computeLevenshteinSimilarity');

    expect(
      scorer.rankRecallCandidate(
        params(
          scorer,
          'configure the remote services in this secure workspace',
          'configure the local service in this secure workspace',
        ),
      ),
    ).toMatchObject({ match: { kind: 'tm', similarity: 91 } });
    expect(levenshtein).toHaveBeenCalledTimes(2);
    expect(levenshtein.mock.calls[0]).not.toEqual(levenshtein.mock.calls[1]);
  });

  it.each([
    { fromFuzzy: true, fromConcordance: false },
    { fromFuzzy: false, fromConcordance: true },
    { fromFuzzy: true, fromConcordance: true },
  ])('rejects one-sided acronym collisions before scoring: %o', (recall) => {
    const scorer = new TMMatchScorer();
    const overlap = vi.spyOn(scorer, 'computeLocalOverlapSimilarity');
    const levenshtein = vi.spyOn(scorer, 'computeLevenshteinSimilarity');
    for (const [source, candidate] of [
      [
        'please contact us before configuring the remote service',
        'please contact US before configuring the local service',
      ],
      [
        'please contact U.S. before configuring the remote service',
        'please contact us before configuring the local service',
      ],
    ]) {
      expect(
        scorer.rankRecallCandidate(params(scorer, source, candidate, 'english', recall)),
      ).toBeNull();
    }
    expect(overlap).not.toHaveBeenCalled();
    expect(levenshtein).not.toHaveBeenCalled();
  });

  it('retains matching uppercase/dotted acronyms and default-profile scoring', () => {
    const scorer = new TMMatchScorer();
    expect(
      scorer.rankRecallCandidate(
        params(
          scorer,
          'please contact US before configuring the remote service',
          'please contact U.S. before configuring the local service',
        ),
      ),
    ).toMatchObject({ match: { kind: 'tm', similarity: 91 } });
    expect(
      scorer.rankRecallCandidate(
        params(
          scorer,
          'please contact us before configuring the remote service',
          'please contact US before configuring the local service',
          'default',
        ),
      ),
    ).toMatchObject({ match: { kind: 'tm', similarity: 91 } });
  });
});
