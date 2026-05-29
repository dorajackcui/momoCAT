import type { Segment, TBMatch, Token } from '@cat/core/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TMMatch } from '../../TMService';
import { resolveTranslationPromptReferences } from './promptReferences';

describe('resolveTranslationPromptReferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps TM matches to tmReferences and the tmReference compatibility field', async () => {
    const tmMatch = createTMMatch({
      kind: 'tm',
      id: 'tm-1',
      sourceText: 'Hello world',
      targetText: 'Bonjour le monde',
      similarity: 98,
    });

    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment(),
      resolvers: {
        tmService: {
          findMatches: vi.fn().mockResolvedValue([tmMatch]),
        },
      },
    });

    expect(references.tmReferences).toEqual([
      {
        similarity: 98,
        tmName: 'Client TM',
        sourceText: 'Hello world',
        targetText: 'Bonjour le monde',
      },
    ]);
    expect(references.tmReference).toBe(references.tmReferences?.[0]);
  });

  it('maps concordance matches to concordanceReferences', async () => {
    const concordanceMatch = createTMMatch({
      kind: 'concordance',
      id: 'concordance-1',
      sourceText: 'Hello world from the archive',
      targetText: 'Bonjour le monde depuis les archives',
      matchedSourceText: 'Hello world',
    });

    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment(),
      resolvers: {
        tmService: {
          findMatches: vi.fn().mockResolvedValue([concordanceMatch]),
        },
      },
    });

    expect(references.concordanceReferences).toEqual([
      {
        tmName: 'Client TM',
        matchedSourceText: 'Hello world',
        sourceText: 'Hello world from the archive',
        targetText: 'Bonjour le monde depuis les archives',
      },
    ]);
  });

  it('maps TB matches to tbReferences with null note normalization', async () => {
    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment(),
      resolvers: {
        tbService: {
          findMatches: vi.fn().mockResolvedValue([
            createTBMatch({ srcTerm: 'account', tgtTerm: 'compte', note: undefined }),
          ]),
        },
      },
    });

    expect(references.tbReferences).toEqual([
      {
        srcTerm: 'account',
        tgtTerm: 'compte',
        note: null,
      },
    ]);
  });

  it('omits empty reference arrays', async () => {
    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment(),
      resolvers: {
        tmService: {
          findMatches: vi.fn().mockResolvedValue([]),
        },
        tbService: {
          findMatches: vi.fn().mockResolvedValue([]),
        },
      },
    });

    expect(references).toEqual({});
  });

  it('catches TM resolver failures and returns no references', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment({ segmentId: 'segment-with-tm-error' }),
      resolvers: {
        tmService: {
          findMatches: vi.fn().mockRejectedValue(new Error('tm unavailable')),
        },
      },
    });

    expect(references).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[AIModule] Failed to resolve TM reference for segment segment-with-tm-error: tm unavailable',
    );
  });

  it('catches TB resolver failures and returns no references', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const references = await resolveTranslationPromptReferences({
      projectId: 7,
      segment: createSegment({ segmentId: 'segment-with-tb-error' }),
      resolvers: {
        tbService: {
          findMatches: vi.fn().mockRejectedValue(new Error('tb unavailable')),
        },
      },
    });

    expect(references).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[AIModule] Failed to resolve TB references for segment segment-with-tb-error: tb unavailable',
    );
  });
});

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'segment-1',
    fileId: 1,
    orderIndex: 0,
    sourceTokens: tokens('Hello world'),
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: 'hello world',
    srcHash: 'source-hash',
    meta: {
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function createTMMatch(
  params:
    | {
        kind: 'tm';
        id: string;
        sourceText: string;
        targetText: string;
        similarity: number;
      }
    | {
        kind: 'concordance';
        id: string;
        sourceText: string;
        targetText: string;
        matchedSourceText: string;
      },
): TMMatch {
  const now = '2026-01-01T00:00:00.000Z';
  const base = {
    id: params.id,
    projectId: 7,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: `${params.id}-hash`,
    matchKey: params.sourceText.toLowerCase(),
    tagsSignature: '',
    sourceTokens: tokens(params.sourceText),
    targetTokens: tokens(params.targetText),
    originSegmentId: 'origin-1',
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
    rank: params.kind === 'tm' ? params.similarity : 90,
    tmName: 'Client TM',
    tmType: 'main' as const,
  };

  if (params.kind === 'tm') {
    return {
      ...base,
      kind: 'tm',
      similarity: params.similarity,
    };
  }

  return {
    ...base,
    kind: 'concordance',
    matchedSourceText: params.matchedSourceText,
    sourceCoverage: 50,
    entryCoverage: 100,
  };
}

function createTBMatch(params: {
  srcTerm: string;
  tgtTerm: string;
  note?: string | null;
}): TBMatch {
  return {
    id: 'tb-match-1',
    tbId: 'tb-1',
    srcTerm: params.srcTerm,
    tgtTerm: params.tgtTerm,
    srcNorm: params.srcTerm,
    note: params.note,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    usageCount: 1,
    tbName: 'Client TB',
    priority: 1,
    positions: [{ start: 0, end: params.srcTerm.length }],
  };
}

function tokens(text: string): Token[] {
  return [{ type: 'text', content: text }];
}
