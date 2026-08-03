import { findTermPositionsInTextForLocale, normalizeTermForLookup } from '@cat/core/text';

export function isWholeSourceTerminologyEquivalent(
  candidate: string,
  historical: string,
  locale: string,
): boolean {
  const candidateNorm = normalizeTermForLookup(candidate, { locale });
  const historicalNorm = normalizeTermForLookup(historical, { locale });
  if (!candidateNorm || !historicalNorm) return false;
  if (candidateNorm === historicalNorm) return true;

  return findTermPositionsInTextForLocale(candidate, historical, { locale }).some(
    (position) =>
      candidate.slice(0, position.start).trim().length === 0 &&
      candidate.slice(position.end).trim().length === 0,
  );
}
