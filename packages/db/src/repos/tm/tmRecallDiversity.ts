import type { Token } from '@cat/core/models';
import type { TMEntryRow, TMRecallOptions } from '../../types';
import type { TMRecallDbRow } from './tmEntryRows';

const TM_RECALL_DIVERSITY_MAX_PER_BUCKET = 2;
const TM_RECALL_DIVERSITY_MIN_CJK_BUCKET_LENGTH = 4;

export function diversifyConcordanceRows(
  query: string,
  rows: TMEntryRow[],
  limit: number,
): TMEntryRow[] {
  const accepted: TMEntryRow[] = [];
  const bucketCounts = new Map<string, number>();
  const rowBuckets = rows.map((row) => getConcordanceDiversityBucket(query, row));
  const canonicalBuckets = buildCanonicalDiversityBuckets(rowBuckets);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rawBucket = rowBuckets[index];
    const bucket = rawBucket ? (canonicalBuckets.get(rawBucket) ?? rawBucket) : null;
    if (!bucket) {
      accepted.push(row);
      continue;
    }

    const count = bucketCounts.get(bucket) ?? 0;
    if (count < TM_RECALL_DIVERSITY_MAX_PER_BUCKET) {
      bucketCounts.set(bucket, count + 1);
      accepted.push(row);
    }
  }

  return accepted.slice(0, limit);
}

export function diversifyRecallRows(
  sourceText: string,
  rows: TMRecallDbRow[],
  limit: number,
  scope: TMRecallOptions['scope'],
): TMRecallDbRow[] {
  const accepted: TMRecallDbRow[] = [];
  const bucketCounts = new Map<string, number>();
  const rowBuckets = rows.map((row) =>
    getRecallDiversityBucket(sourceText, row, scope ?? 'source'),
  );
  const canonicalBuckets = buildCanonicalDiversityBuckets(rowBuckets);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rawBucket = rowBuckets[index];
    const bucket = rawBucket ? (canonicalBuckets.get(rawBucket) ?? rawBucket) : null;
    if (!bucket) {
      accepted.push(row);
    } else {
      const count = bucketCounts.get(bucket) ?? 0;
      if (count >= TM_RECALL_DIVERSITY_MAX_PER_BUCKET) continue;
      bucketCounts.set(bucket, count + 1);
      accepted.push(row);
    }

    if (accepted.length >= limit) break;
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

function getRecallDiversityBucket(
  sourceText: string,
  row: TMRecallDbRow,
  scope: 'source' | 'source-and-target',
): string | null {
  const normalizedQuery = normalizeForOverlap(sourceText);
  const candidateTexts =
    scope === 'source-and-target' ? [row.ftsSrcText, row.ftsTgtText] : [row.ftsSrcText];

  return getBestDiversityBucket(normalizedQuery, candidateTexts);
}

function getConcordanceDiversityBucket(query: string, row: TMEntryRow): string | null {
  const normalizedQuery = normalizeForOverlap(query);
  const candidateTexts = [
    normalizeForOverlap(serializeTokensForOverlap(row.sourceTokens)),
    normalizeForOverlap(serializeTokensForOverlap(row.targetTokens)),
  ];
  return getBestDiversityBucket(normalizedQuery, candidateTexts);
}

function getBestDiversityBucket(query: string, candidateTexts: string[]): string | null {
  let best = '';

  for (const candidateText of candidateTexts) {
    const overlap = findLongestCommonSubstring(query, normalizeForOverlap(candidateText));
    if (Array.from(overlap).length > Array.from(best).length) {
      best = overlap;
    }
  }

  if (!isStrongCjkDiversityBucket(best)) return null;
  return best;
}

function serializeTokensForOverlap(tokens: Token[]): string {
  return tokens.map((token) => token.content).join('');
}

export function normalizeForOverlap(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findLongestCommonSubstring(a: string, b: string): string {
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

function isStrongCjkDiversityBucket(fragment: string): boolean {
  return (
    /^[\u4e00-\u9fa5]+$/.test(fragment) &&
    Array.from(fragment).length >= TM_RECALL_DIVERSITY_MIN_CJK_BUCKET_LENGTH
  );
}
