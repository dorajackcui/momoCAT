import { describe, expect, it, vi } from 'vitest';
import type { Segment, TMEntry } from '@cat/core/models';
import { serializeTokensToTextOnly } from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import { TMService, type TMMatch } from './TMService';
import type { ProjectRepository, TMRepository } from './ports';

type TMEntryWithTmId = TMEntry & { tmId: string };

interface TraceLocalOverlapResult {
  score: number;
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

type TraceableTMService = {
  normalizeForSimilarity(text: string): string;
  computeLocalOverlapSimilarity(a: string, b: string): TraceLocalOverlapResult;
  promoteContainedConcordanceOverlap(
    localOverlap: TraceLocalOverlapResult,
  ): TraceLocalOverlapResult;
  computeMaxLengthBound(a: string, b: string): number;
  computeLevenshteinSimilarity(a: string, b: string): number;
  computeDiceSimilarity(a: string, b: string): number;
  computeSimilarityBonus(a: string, b: string): number;
  shouldClassifyLocalOverlapAsConcordance(
    standardSimilarity: number,
    localOverlap: TraceLocalOverlapResult,
  ): boolean;
  getExactNormalizedDiversityBucket(normalizedText: string): string | null;
  getLocalOverlapDiversityBucket(localOverlap: TraceLocalOverlapResult): string | null;
};

const ACTIVE_SOURCE = '阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。';
const TARGET_HASHES = ['amo-glass', 'fresh-king'];

function createSegment(sourceText: string, srcHash: string): Segment {
  return {
    segmentId: `seg-${srcHash}`,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: sourceText }],
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: sourceText.toLowerCase(),
    srcHash,
    meta: { updatedAt: new Date().toISOString() },
  };
}

function createRuntimeTMEntry(
  tmId: string,
  params: {
    srcHash: string;
    sourceText: string;
    targetText: string;
    projectId: number;
  },
): TMEntryWithTmId {
  const now = new Date().toISOString();
  return {
    id: `runtime-${params.srcHash}`,
    tmId,
    projectId: params.projectId,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: params.srcHash,
    matchKey: params.sourceText.toLowerCase(),
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: params.sourceText }],
    targetTokens: [{ type: 'text', content: params.targetText }],
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function seedCrowdedContainedCjkFixture(db: CATDatabase): { projectId: number; tmId: string } {
  const projectId = db.createProject('Trace Active TM Match', 'zh-CN', 'fr-FR');
  const tmId = db.createTM('TM_TEST', 'zh-CN', 'fr-FR', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');

  for (let index = 0; index < 160; index += 1) {
    db.upsertTMEntry(
      createRuntimeTMEntry(tmId, {
        projectId,
        srcHash: `crowded-concordance-${index}`,
        sourceText: `因绝望病逝世的心愿精灵噪声${index}`,
        targetText: `crowded concordance ${index}`,
      }),
    );
  }

  db.upsertTMEntry(
    createRuntimeTMEntry(tmId, {
      projectId,
      srcHash: 'amo-glass',
      sourceText: '阿茉玻',
      targetText: 'Amorbo',
    }),
  );
  db.upsertTMEntry(
    createRuntimeTMEntry(tmId, {
      projectId,
      srcHash: 'fresh-king',
      sourceText: '清新天王',
      targetText: 'Souverain de la fraicheur',
    }),
  );

  return { projectId, tmId };
}

function textOf(entry: Pick<TMEntry, 'sourceTokens'>): string {
  return entry.sourceTokens.map((token) => token.content).join('');
}

function summarizeEntry(entry: TMEntryWithTmId) {
  return {
    id: entry.id,
    tmId: entry.tmId,
    srcHash: entry.srcHash,
    sourceText: textOf(entry),
    targetText: entry.targetTokens.map((token) => token.content).join(''),
    usageCount: entry.usageCount,
  };
}

function summarizeMatch(match: TMMatch) {
  return {
    srcHash: match.srcHash,
    kind: match.kind,
    rank: match.rank,
    similarity: match.kind === 'tm' ? match.similarity : undefined,
    matchedSourceText: match.kind === 'concordance' ? match.matchedSourceText : undefined,
    sourceCoverage: match.kind === 'concordance' ? match.sourceCoverage : undefined,
    entryCoverage: match.kind === 'concordance' ? match.entryCoverage : undefined,
    sourceText: textOf(match),
    tmName: match.tmName,
    tmType: match.tmType,
  };
}

function summarizeRecall(entries: TMEntryWithTmId[]) {
  const candidates = entries.map(summarizeEntry);
  return {
    count: entries.length,
    candidates,
    targets: Object.fromEntries(
      TARGET_HASHES.map((srcHash) => [
        srcHash,
        candidates.filter((candidate) => candidate.srcHash === srcHash),
      ]),
    ),
  };
}

function traceCandidateScoring(params: {
  service: TMService;
  mountedTMs: ReturnType<CATDatabase['getProjectMountedTMs']>;
  sourceNormalized: string;
  exactHashMatches: TMEntryWithTmId[];
  fuzzyCandidates: TMEntryWithTmId[];
  concordanceCandidates: TMEntryWithTmId[];
}) {
  const debugService = params.service as unknown as TraceableTMService;
  const candidateMap = new Map<
    string,
    { candidate: TMEntryWithTmId; fromFuzzy: boolean; fromConcordance: boolean }
  >();
  const seenHashes = new Set(params.exactHashMatches.map((match) => match.srcHash));

  for (const candidate of params.fuzzyCandidates) {
    candidateMap.set(candidate.id, {
      candidate,
      fromFuzzy: true,
      fromConcordance: false,
    });
  }

  for (const candidate of params.concordanceCandidates) {
    const existing = candidateMap.get(candidate.id);
    if (existing) {
      existing.fromConcordance = true;
    } else {
      candidateMap.set(candidate.id, {
        candidate,
        fromFuzzy: false,
        fromConcordance: true,
      });
    }
  }

  return Array.from(candidateMap.values()).map((candidateState) => {
    const cand = candidateState.candidate;
    const candTextOnly = serializeTokensToTextOnly(cand.sourceTokens);
    const candNormalized = debugService.normalizeForSimilarity(candTextOnly);
    const sourceLength = Array.from(params.sourceNormalized).length;
    const candidateLength = Array.from(candNormalized).length;
    const base = {
      ...summarizeEntry(cand),
      fromFuzzy: candidateState.fromFuzzy,
      fromConcordance: candidateState.fromConcordance,
      candTextOnly,
      candNormalized,
      sourceLength,
      candidateLength,
    };

    if (seenHashes.has(cand.srcHash)) {
      return {
        ...base,
        accepted: false,
        droppedAt: 'seenHash',
      };
    }

    if (
      !candidateState.fromFuzzy &&
      candidateState.fromConcordance &&
      candidateLength > sourceLength * 3
    ) {
      return {
        ...base,
        accepted: false,
        droppedAt: 'concordanceOnlyLengthGuard',
      };
    }

    let standardSimilarity = 0;
    let maxPossibleByLength: number | null = null;
    let levSimilarity: number | null = null;
    let diceSimilarity: number | null = null;
    let bonus: number | null = null;
    let localOverlap: TraceLocalOverlapResult = {
      score: 0,
      matchedSourceText: '',
      sourceCoverage: 0,
      entryCoverage: 0,
    };

    if (params.sourceNormalized === candNormalized) {
      standardSimilarity = 99;
    } else {
      localOverlap = debugService.computeLocalOverlapSimilarity(
        params.sourceNormalized,
        candNormalized,
      );
      if (candidateState.fromConcordance) {
        localOverlap = debugService.promoteContainedConcordanceOverlap(localOverlap);
      }
      maxPossibleByLength = debugService.computeMaxLengthBound(
        params.sourceNormalized,
        candNormalized,
      );

      if (maxPossibleByLength >= 50) {
        levSimilarity = debugService.computeLevenshteinSimilarity(
          params.sourceNormalized,
          candNormalized,
        );
        diceSimilarity = debugService.computeDiceSimilarity(params.sourceNormalized, candNormalized);
        bonus = debugService.computeSimilarityBonus(params.sourceNormalized, candNormalized);
        standardSimilarity = Math.min(
          99,
          Math.round(levSimilarity * 0.75 + diceSimilarity * 0.25 + bonus),
        );
      }
    }

    const diversityBucket =
      params.sourceNormalized === candNormalized
        ? debugService.getExactNormalizedDiversityBucket(params.sourceNormalized)
        : debugService.getLocalOverlapDiversityBucket(localOverlap);

    if (debugService.shouldClassifyLocalOverlapAsConcordance(standardSimilarity, localOverlap)) {
      return {
        ...base,
        accepted: true,
        kind: 'concordance',
        rank: localOverlap.score,
        classificationRule: 'localOverlapBeatsStandardSimilarity',
        standardSimilarity,
        maxPossibleByLength,
        levSimilarity,
        diceSimilarity,
        bonus,
        localOverlap,
        diversityBucket,
      };
    }

    if (standardSimilarity >= 50) {
      return {
        ...base,
        accepted: true,
        kind: 'tm',
        rank: standardSimilarity,
        classificationRule: 'standardSimilarity',
        standardSimilarity,
        maxPossibleByLength,
        levSimilarity,
        diceSimilarity,
        bonus,
        localOverlap,
        diversityBucket,
      };
    }

    if (localOverlap.score >= 50) {
      return {
        ...base,
        accepted: true,
        kind: 'concordance',
        rank: localOverlap.score,
        classificationRule: 'localOverlap',
        standardSimilarity,
        maxPossibleByLength,
        levSimilarity,
        diceSimilarity,
        bonus,
        localOverlap,
        diversityBucket,
      };
    }

    return {
      ...base,
      accepted: false,
      droppedAt: 'belowThreshold',
      standardSimilarity,
      maxPossibleByLength,
      levSimilarity,
      diceSimilarity,
      bonus,
      localOverlap,
      diversityBucket,
    };
  });
}

async function traceActiveTMMatchFlow(params: {
  db: CATDatabase;
  projectId: number;
  source: string;
  srcHash: string;
}) {
  const service = new TMService(
    params.db as unknown as ProjectRepository,
    params.db as unknown as TMRepository,
  );
  const debugService = service as unknown as TraceableTMService;
  const segment = createSegment(params.source, params.srcHash);
  const mountedTMs = params.db.getProjectMountedTMs(params.projectId);
  const tmIds = mountedTMs.map((tm) => tm.id);
  const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
  const sourceNormalized = debugService.normalizeForSimilarity(sourceTextOnly);
  const exactHashMatches = mountedTMs
    .map((tm) => params.db.findTMEntryByHash(tm.id, segment.srcHash) as TMEntryWithTmId | undefined)
    .filter((match): match is TMEntryWithTmId => Boolean(match));
  const fuzzyCandidates = params.db.searchTMFuzzyRecallCandidates(
    params.projectId,
    sourceTextOnly,
    tmIds,
    { scope: 'source', limit: 50 },
  ) as TMEntryWithTmId[];
  const concordanceCandidates = params.db.searchTMConcordanceRecallCandidates(
    params.projectId,
    sourceTextOnly,
    tmIds,
    { scope: 'source', limit: 50, rawLimit: 200 },
  ) as TMEntryWithTmId[];
  const candidateScoring = traceCandidateScoring({
    service,
    mountedTMs,
    sourceNormalized,
    exactHashMatches,
    fuzzyCandidates,
    concordanceCandidates,
  });
  const finalMatches = await service.findMatches(params.projectId, segment);

  return {
    scenario: {
      name: 'contained CJK entries under crowded active concordance recall',
      expectedTargets: TARGET_HASHES,
    },
    step0MountedTMs: mountedTMs.map((tm) => ({
      id: tm.id,
      name: tm.name,
      type: tm.type,
      priority: tm.priority,
      permission: tm.permission,
      isEnabled: tm.isEnabled,
    })),
    step1SourceText: {
      original: params.source,
      sourceTextOnly,
      sourceNormalized,
      sourceLength: Array.from(sourceNormalized).length,
    },
    step2ExactHash: {
      count: exactHashMatches.length,
      candidates: exactHashMatches.map(summarizeEntry),
    },
    step3FuzzyRecall: summarizeRecall(fuzzyCandidates),
    step4ConcordanceRecall: summarizeRecall(concordanceCandidates),
    step5CandidateScoring: candidateScoring,
    step6FinalMatches: finalMatches.map(summarizeMatch),
  };
}

describe('TM match flow trace', () => {
  it('records each active TM match stage for contained CJK recall under crowded candidates', async () => {
    const previousDebug = process.env.CAT_TM_RECALL_DEBUG;
    const recallDebugEvents: Array<{ message: unknown; payload: unknown }> = [];
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation((message, payload) => {
      recallDebugEvents.push({ message, payload });
    });
    process.env.CAT_TM_RECALL_DEBUG = '1';

    const db = new CATDatabase(':memory:');
    try {
      const { projectId } = seedCrowdedContainedCjkFixture(db);
      const trace = {
        ...(await traceActiveTMMatchFlow({
          db,
          projectId,
          source: ACTIVE_SOURCE,
          srcHash: 'active-source-hash',
        })),
        recallDebugEvents,
      };

      if (
        process.env.npm_lifecycle_event === 'test:tm-flow' ||
        process.env.TM_MATCH_FLOW_TRACE === '1'
      ) {
        console.info(`[TM match flow trace]\n${JSON.stringify(trace, null, 2)}`);
      }

      expect(trace.step4ConcordanceRecall.targets['amo-glass']).toHaveLength(1);
      expect(trace.step4ConcordanceRecall.targets['fresh-king']).toHaveLength(1);

      const amoScore = trace.step5CandidateScoring.find(
        (candidate) => candidate.srcHash === 'amo-glass',
      );
      const freshKingScore = trace.step5CandidateScoring.find(
        (candidate) => candidate.srcHash === 'fresh-king',
      );
      expect(amoScore).toMatchObject({
        accepted: true,
        kind: 'concordance',
        rank: 50,
        classificationRule: 'localOverlap',
      });
      expect(freshKingScore).toMatchObject({
        accepted: true,
        kind: 'concordance',
        rank: 50,
        classificationRule: 'localOverlap',
      });

      expect(trace.step6FinalMatches.map((match) => match.srcHash)).toEqual(
        expect.arrayContaining(['amo-glass', 'fresh-king']),
      );
    } finally {
      db.close();
      debugSpy.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.CAT_TM_RECALL_DEBUG;
      } else {
        process.env.CAT_TM_RECALL_DEBUG = previousDebug;
      }
    }
  });
});
