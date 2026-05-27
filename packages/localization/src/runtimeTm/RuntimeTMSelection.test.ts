import { parseDisplayTextToTokens } from '@cat/core/tag';
import { describe, expect, it } from 'vitest';
import type { TMArtifact } from '../artifacts';
import { mergeRuntimeTMArtifact } from './RuntimeTMSelection';

type RawTMMatch = TMArtifact['rawMatches'][number];

describe('mergeRuntimeTMArtifact', () => {
  it('keeps independent runtime and persistent TM slots then sorts by rank', () => {
    const persistent = artifact('unit-1', [
      tm('p-100', 100, 'Persistent 100', 'P100'),
      tm('p-99', 99, 'Persistent 99', 'P99'),
      tm('p-98', 98, 'Persistent 98', 'P98'),
      tm('p-97', 97, 'Persistent 97', 'P97'),
    ]);
    const runtime = artifact('unit-1', [
      tm('r-101', 101, 'Runtime 101', 'R101', 'Runtime TM'),
      tm('r-96', 96, 'Runtime 96', 'R96', 'Runtime TM'),
      tm('r-95', 95, 'Runtime 95', 'R95', 'Runtime TM'),
      tm('r-94', 94, 'Runtime 94', 'R94', 'Runtime TM'),
    ]);

    const merged = mergeRuntimeTMArtifact({ persistent, runtime });

    expect(merged.selectedReferences.tmReferences.map((ref) => ref.sourceText)).toEqual([
      'Runtime 101',
      'Persistent 100',
      'Persistent 99',
      'Persistent 98',
      'Runtime 96',
      'Runtime 95',
    ]);
    expect(merged.selectionPolicy).toEqual({
      maxTmReferences: 6,
      maxConcordanceReferences: 6,
    });
  });

  it('keeps independent runtime and persistent concordance slots', () => {
    const persistent = artifact('unit-1', [
      cc('pc-90', 90, 'Persistent concordance 90', 'PC90'),
      cc('pc-89', 89, 'Persistent concordance 89', 'PC89'),
      cc('pc-88', 88, 'Persistent concordance 88', 'PC88'),
      cc('pc-87', 87, 'Persistent concordance 87', 'PC87'),
    ]);
    const runtime = artifact('unit-1', [
      cc('rc-91', 91, 'Runtime concordance 91', 'RC91', 'Runtime TM'),
      cc('rc-86', 86, 'Runtime concordance 86', 'RC86', 'Runtime TM'),
      cc('rc-85', 85, 'Runtime concordance 85', 'RC85', 'Runtime TM'),
      cc('rc-84', 84, 'Runtime concordance 84', 'RC84', 'Runtime TM'),
    ]);

    const merged = mergeRuntimeTMArtifact({ persistent, runtime });

    expect(merged.selectedReferences.concordanceReferences.map((ref) => ref.sourceText)).toEqual([
      'Runtime concordance 91',
      'Persistent concordance 90',
      'Persistent concordance 89',
      'Persistent concordance 88',
      'Runtime concordance 86',
      'Runtime concordance 85',
    ]);
  });
});

function artifact(unitId: string, rawMatches: RawTMMatch[]): TMArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTMs: [],
    rawMatches,
    selectedReferences: { tmReferences: [], concordanceReferences: [] },
    selectionPolicy: { maxTmReferences: 3, maxConcordanceReferences: 3 },
    diagnostics: [],
  };
}

function tm(
  id: string,
  rank: number,
  source: string,
  target: string,
  tmName = 'Persistent TM',
): RawTMMatch {
  return {
    id,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: id,
    matchKey: id,
    tagsSignature: '',
    sourceTokens: parseDisplayTextToTokens(source),
    targetTokens: parseDisplayTextToTokens(target),
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    usageCount: 1,
    kind: 'tm',
    rank,
    similarity: rank,
    tmName,
    tmType: 'main',
  };
}

function cc(
  id: string,
  rank: number,
  source: string,
  target: string,
  tmName = 'Persistent TM',
): RawTMMatch {
  return {
    ...tm(id, rank, source, target, tmName),
    kind: 'concordance',
    matchedSourceText: source.split(' ')[0] ?? source,
    sourceCoverage: 50,
    entryCoverage: 100,
  };
}
