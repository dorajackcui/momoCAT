import type { TMArtifact } from '../artifacts';
import { buildTMPromptReferences } from '../modules/TMModule';

type RawTMMatch = TMArtifact['rawMatches'][number];

const PERSISTENT_TM_REFERENCE_LIMIT = 3;
const RUNTIME_TM_REFERENCE_LIMIT = 3;
const PERSISTENT_CONCORDANCE_REFERENCE_LIMIT = 3;
const RUNTIME_CONCORDANCE_REFERENCE_LIMIT = 3;

export function mergeRuntimeTMArtifact(input: {
  persistent: TMArtifact;
  runtime: TMArtifact;
}): TMArtifact {
  const selectionPolicy = {
    maxTmReferences: PERSISTENT_TM_REFERENCE_LIMIT + RUNTIME_TM_REFERENCE_LIMIT,
    maxConcordanceReferences:
      PERSISTENT_CONCORDANCE_REFERENCE_LIMIT + RUNTIME_CONCORDANCE_REFERENCE_LIMIT,
  };
  const persistentTmMatches = selectTopMatches(
    input.persistent.rawMatches,
    'tm',
    PERSISTENT_TM_REFERENCE_LIMIT,
  );
  const runtimeTmMatches = selectTopMatches(
    input.runtime.rawMatches,
    'tm',
    RUNTIME_TM_REFERENCE_LIMIT,
  );
  const persistentConcordanceMatches = selectTopMatches(
    input.persistent.rawMatches,
    'concordance',
    PERSISTENT_CONCORDANCE_REFERENCE_LIMIT,
  );
  const runtimeConcordanceMatches = selectTopMatches(
    input.runtime.rawMatches,
    'concordance',
    RUNTIME_CONCORDANCE_REFERENCE_LIMIT,
  );
  const selectedMatches = [
    ...persistentTmMatches,
    ...runtimeTmMatches,
    ...persistentConcordanceMatches,
    ...runtimeConcordanceMatches,
  ].sort(compareMatches);

  return {
    ...input.persistent,
    mountedTMs: [...input.persistent.mountedTMs, ...input.runtime.mountedTMs],
    rawMatches: selectedMatches,
    selectedReferences: buildTMPromptReferences(selectedMatches, selectionPolicy),
    selectionPolicy,
    diagnostics: [...input.persistent.diagnostics, ...input.runtime.diagnostics],
  };
}

function selectTopMatches<K extends RawTMMatch['kind']>(
  matches: RawTMMatch[],
  kind: K,
  limit: number,
): Array<Extract<RawTMMatch, { kind: K }>> {
  return matches
    .filter((match): match is Extract<RawTMMatch, { kind: K }> => match.kind === kind)
    .sort(compareMatches)
    .slice(0, limit);
}

function compareMatches(left: RawTMMatch, right: RawTMMatch): number {
  if (right.rank !== left.rank) return right.rank - left.rank;
  if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
  return left.id.localeCompare(right.id);
}
