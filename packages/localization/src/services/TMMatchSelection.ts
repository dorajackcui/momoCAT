import type { RankedTMMatch, TMMatch } from './TMMatchTypes';

const TM_MATCH_RESULT_LIMIT = 3;
const CONCORDANCE_MATCH_RESULT_LIMIT = 7;
const DIVERSITY_MAX_PER_BUCKET = 2;

export function finalizeTMMatches(results: RankedTMMatch[]): TMMatch[] {
  const sortedResults = results.sort((a, b) => {
    if (b.match.rank !== a.match.rank) return b.match.rank - a.match.rank;
    return b.match.usageCount - a.match.usageCount;
  });
  return selectMatchesByKindLimits(diversifyRankedMatches(sortedResults)).map(
    (result) => result.match,
  );
}

function selectMatchesByKindLimits(results: RankedTMMatch[]): RankedTMMatch[] {
  const selected: RankedTMMatch[] = [];
  let tmCount = 0;
  let concordanceCount = 0;

  for (const result of results) {
    if (result.match.kind === 'tm') {
      if (tmCount >= TM_MATCH_RESULT_LIMIT) continue;
      tmCount += 1;
    } else {
      if (concordanceCount >= CONCORDANCE_MATCH_RESULT_LIMIT) continue;
      concordanceCount += 1;
    }
    selected.push(result);
  }
  return selected;
}

function diversifyRankedMatches(results: RankedTMMatch[]): RankedTMMatch[] {
  const accepted: RankedTMMatch[] = [];
  const bucketCounts = new Map<string, number>();
  const canonicalBuckets = buildCanonicalDiversityBuckets(
    results.map((result) => result.diversityBucket),
  );

  for (const result of results) {
    const bucket = result.diversityBucket
      ? (canonicalBuckets.get(result.diversityBucket) ?? result.diversityBucket)
      : null;
    if (!bucket) {
      accepted.push(result);
      continue;
    }

    const count = bucketCounts.get(bucket) ?? 0;
    if (count < DIVERSITY_MAX_PER_BUCKET) {
      bucketCounts.set(bucket, count + 1);
      accepted.push(result);
    }
  }
  return accepted;
}

function buildCanonicalDiversityBuckets(buckets: Array<string | null>): Map<string, string> {
  const uniqueBuckets = Array.from(
    new Set(buckets.filter((bucket): bucket is string => Boolean(bucket))),
  ).sort((a, b) => Array.from(b).length - Array.from(a).length);
  const canonicalBuckets = new Map<string, string>();

  for (const bucket of uniqueBuckets) {
    const containingBucket = uniqueBuckets.find(
      (candidate) => candidate !== bucket && candidate.includes(bucket),
    );
    canonicalBuckets.set(bucket, containingBucket ?? bucket);
  }
  return canonicalBuckets;
}
