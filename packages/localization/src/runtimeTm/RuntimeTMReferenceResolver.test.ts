import { parseDisplayTextToTokens } from '@cat/core/tag';
import { describe, expect, it, vi } from 'vitest';
import type { TMArtifact } from '../artifacts';
import type { ResolvedReferences } from '../requestModes/types';
import { createTransientSegment } from '../transientSegment';
import { RuntimeTMReferenceResolver } from './RuntimeTMReferenceResolver';

type RawTMMatch = TMArtifact['rawMatches'][number];

describe('RuntimeTMReferenceResolver', () => {
  it('returns persistent references unchanged when runtime TM is empty', async () => {
    const persistentReferences = resolvedReferences({
      persistentMatches: [tm('p-100', 100, 'Persistent source', 'Persistent target')],
    });
    const persistentResolver = vi.fn(async () => persistentReferences);
    const runtimeTm = {
      hasEntries: vi.fn(() => false),
      inspect: vi.fn(),
    };
    const segment = createTransientSegment({ id: 'unit-1', source: 'Source' }, 0);
    const resolver = new RuntimeTMReferenceResolver(runtimeTm, persistentResolver);

    const resolved = await resolver.resolve({
      projectId: 1,
      segment,
      tmModule: { inspect: vi.fn() },
      tbModule: { inspect: vi.fn() },
    });

    expect(resolved).toBe(persistentReferences);
    expect(persistentResolver).toHaveBeenCalledTimes(1);
    expect(runtimeTm.inspect).not.toHaveBeenCalled();
  });

  it('merges runtime and persistent TM references while preserving TB references', async () => {
    const persistentReferences = resolvedReferences({
      persistentMatches: [tm('p-100', 100, 'Persistent source', 'Persistent target')],
    });
    const persistentResolver = vi.fn(async () => persistentReferences);
    const runtimeTm = {
      hasEntries: vi.fn(() => true),
      inspect: vi.fn(async () =>
        artifact('unit-1', [tm('r-101', 101, 'Runtime source', 'Runtime target', 'Runtime TM')]),
      ),
    };
    const segment = createTransientSegment({ id: 'unit-1', source: 'Source' }, 0);
    const resolver = new RuntimeTMReferenceResolver(runtimeTm, persistentResolver);

    const resolved = await resolver.resolve({
      projectId: 1,
      segment,
      tmModule: { inspect: vi.fn() },
      tbModule: { inspect: vi.fn() },
    });

    expect(persistentResolver).toHaveBeenCalledTimes(1);
    expect(runtimeTm.inspect).toHaveBeenCalledWith(segment);
    expect(resolved.tb).toBe(persistentReferences.tb);
    expect(resolved.engineReferences.tb).toBe(persistentReferences.engineReferences.tb);
    expect(resolved.tm.selectedReferences.tmReferences.map((ref) => ref.tmName)).toEqual([
      'Runtime TM',
      'Persistent TM',
    ]);
    expect(resolved.engineReferences.tm.map((ref) => ref.tmName)).toEqual([
      'Runtime TM',
      'Persistent TM',
    ]);
  });
});

function resolvedReferences(input: { persistentMatches: RawTMMatch[] }): ResolvedReferences {
  const tbReferences = [{ tbName: 'Persistent TB', srcTerm: 'source', tgtTerm: 'target' }];

  return {
    engineReferences: {
      tm: input.persistentMatches.map((match) => ({
        kind: match.kind,
        rank: match.rank,
        similarity: match.kind === 'tm' ? match.similarity : undefined,
        tmName: match.tmName,
        sourceText: match.sourceTokens.map((token) => token.text).join(''),
        targetText: match.targetTokens.map((token) => token.text).join(''),
      })),
      tb: tbReferences,
    },
    tm: artifact('unit-1', input.persistentMatches),
    tb: {
      unitId: 'unit-1',
      segmentId: 'segment-unit-1',
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: [],
      selectionPolicy: { maxTbReferences: 0 },
      diagnostics: [],
    },
  };
}

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
