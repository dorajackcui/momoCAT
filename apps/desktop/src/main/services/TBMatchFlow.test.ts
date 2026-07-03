import { describe, expect, it } from 'vitest';
import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  buildEnglishTermRecognizer,
  buildTermSearchPlanForLocale,
  findTermPositionsInTextForLocale,
  normalizeTermForLookup,
  resolveSourceRecallProfile,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  suppressNestedTermMatches,
} from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import { TBService } from './TBService';
import type { ProjectRepository, TBRepository } from './ports';

type ProjectTBEntry = TBEntry & {
  tbName: string;
  priority: number;
};

interface TraceTBMatchFlowParams {
  db: CATDatabase;
  projectId: number;
  source?: string;
  segment?: Segment;
  focusSrcTerms?: string[];
  focusTgtTerms?: string[];
  scenarioName?: string;
}

interface TraceEnvConfig {
  dbPath: string;
  projectId: number;
  source?: string;
  segmentId?: string;
  focusSrcTerms: string[];
  focusTgtTerms: string[];
}

const TB_CANDIDATE_LIMIT = 200;
const FOCUS_SCAN_LIMIT_PER_TB = 20_000;

function createSegment(sourceText: string): Segment {
  return {
    segmentId: 'tb-match-flow-trace-source',
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: sourceText }],
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: sourceText.toLowerCase(),
    srcHash: 'tb-match-flow-trace-source',
    meta: { updatedAt: new Date().toISOString() },
  };
}

function parseTraceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.replace(/\^/g, '').trim())
    .filter(Boolean);
}

function cleanTraceText(value: string | undefined): string | undefined {
  return value?.replace(/\^/g, '');
}

function normalizeFocusValue(value: string): string {
  return normalizeTermForLookup(value).toLocaleLowerCase();
}

function matchesFocus(
  entry: Pick<TBEntry, 'srcTerm' | 'srcNorm' | 'tgtTerm'>,
  focusSrcTerms: string[],
  focusTgtTerms: string[],
): boolean {
  if (focusSrcTerms.length === 0 && focusTgtTerms.length === 0) return false;

  const srcTerm = normalizeFocusValue(entry.srcTerm);
  const srcNorm = normalizeFocusValue(entry.srcNorm);
  const tgtTerm = normalizeFocusValue(entry.tgtTerm);

  return (
    focusSrcTerms.some((term) => {
      const normalized = normalizeFocusValue(term);
      return srcTerm.includes(normalized) || srcNorm.includes(normalized);
    }) ||
    focusTgtTerms.some((term) => {
      const normalized = normalizeFocusValue(term);
      return tgtTerm.includes(normalized);
    })
  );
}

function summarizeEntry(entry: ProjectTBEntry) {
  return {
    id: entry.id,
    tbId: entry.tbId,
    tbName: entry.tbName,
    priority: entry.priority,
    srcTerm: entry.srcTerm,
    tgtTerm: entry.tgtTerm,
    srcNorm: entry.srcNorm,
    usageCount: entry.usageCount,
  };
}

function summarizeMatch(match: TBMatch) {
  return {
    id: match.id,
    tbId: match.tbId,
    tbName: match.tbName,
    priority: match.priority,
    srcTerm: match.srcTerm,
    tgtTerm: match.tgtTerm,
    srcNorm: match.srcNorm,
    positions: match.positions,
  };
}

function uniqueProjectTBEntries(entries: ProjectTBEntry[]): ProjectTBEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function collectFocusEntriesFromMountedTBs(
  db: CATDatabase,
  mountedTBs: ReturnType<CATDatabase['getProjectMountedTermBases']>,
  focusSrcTerms: string[],
  focusTgtTerms: string[],
) {
  if (focusSrcTerms.length === 0 && focusTgtTerms.length === 0) return [];

  const results: ProjectTBEntry[] = [];
  for (const tb of mountedTBs) {
    const entries = db.listTBEntries(tb.id, FOCUS_SCAN_LIMIT_PER_TB, 0);
    for (const entry of entries) {
      if (!matchesFocus(entry, focusSrcTerms, focusTgtTerms)) continue;
      results.push({
        ...entry,
        tbName: tb.name,
        priority: tb.priority,
      });
    }
  }

  return results;
}

function traceLegacyCandidateFinalMatching(params: {
  sourceText: string;
  srcLang: string;
  candidates: ProjectTBEntry[];
}) {
  const seenSrcNorm = new Set<string>();

  return params.candidates.map((entry) => {
    if (seenSrcNorm.has(entry.srcNorm)) {
      return {
        ...summarizeEntry(entry),
        accepted: false,
        droppedAt: 'duplicateSrcNorm',
        positions: [],
      };
    }

    const positions = findTermPositionsInTextForLocale(params.sourceText, entry.srcTerm, {
      locale: params.srcLang,
    });
    if (positions.length === 0) {
      return {
        ...summarizeEntry(entry),
        accepted: false,
        droppedAt: 'noFinalTermPosition',
        positions,
      };
    }

    seenSrcNorm.add(entry.srcNorm);
    return {
      ...summarizeEntry(entry),
      accepted: true,
      positions,
    };
  });
}

function traceEnglishCandidateFinalMatching(params: {
  sourceText: string;
  hardBoundaryOffsets: number[];
  candidates: ProjectTBEntry[];
}) {
  const recognizedMatches = buildEnglishTermRecognizer(params.candidates).scan(params.sourceText, {
    hardBoundaryOffsets: params.hardBoundaryOffsets,
  });
  const positionsByEntryId = new Map<string, Array<{ start: number; end: number }>>();

  for (const match of recognizedMatches) {
    const positions = positionsByEntryId.get(match.entry.id) ?? [];
    positions.push({ start: match.start, end: match.end });
    positionsByEntryId.set(match.entry.id, positions);
  }

  const seenSrcNorm = new Set<string>();
  return params.candidates.map((entry) => {
    if (seenSrcNorm.has(entry.srcNorm)) {
      return {
        ...summarizeEntry(entry),
        accepted: false,
        droppedAt: 'duplicateSrcNorm',
        positions: [],
      };
    }

    const positions = positionsByEntryId.get(entry.id) ?? [];
    if (positions.length === 0) {
      return {
        ...summarizeEntry(entry),
        accepted: false,
        droppedAt: 'noFinalTermPosition',
        positions,
      };
    }

    seenSrcNorm.add(entry.srcNorm);
    return {
      ...summarizeEntry(entry),
      accepted: true,
      positions,
    };
  });
}

async function traceTBMatchFlow(params: TraceTBMatchFlowParams) {
  const project = params.db.getProject(params.projectId);
  if (!project) {
    throw new Error(`Project not found: ${params.projectId}`);
  }

  const service = new TBService(
    params.db as unknown as ProjectRepository,
    params.db as unknown as TBRepository,
  );
  const segment = params.segment ?? createSegment(params.source ?? '');
  const serializedSearchText = serializeTokensToSearchTextWithBoundaries(segment.sourceTokens);
  const sourceText = serializedSearchText.text;
  const mountedTBs = params.db.getProjectMountedTermBases(params.projectId);
  const sourceProfile = resolveSourceRecallProfile(project.srcLang);
  const searchPlan = buildTermSearchPlanForLocale(sourceText, {
    locale: project.srcLang,
    maxFragments: 36,
  });
  const repoCandidates = params.db.searchProjectTermEntries(params.projectId, sourceText, {
    srcLang: project.srcLang,
    limit: TB_CANDIDATE_LIMIT,
  }) as ProjectTBEntry[];
  const mountedEntryCount = mountedTBs.reduce(
    (total, tb) => total + params.db.getTermBaseStats(tb.id).entryCount,
    0,
  );
  const recognizerEntries =
    sourceProfile === 'en'
      ? (params.db.listProjectTermEntries(params.projectId) as ProjectTBEntry[])
      : [];
  const isRecognizerComplete =
    sourceProfile === 'en' && recognizerEntries.length >= mountedEntryCount;
  const shouldUseLegacyFullMountedScan = sourceProfile === 'cjk' && repoCandidates.length === 0;
  const wouldQueryDbFallback = sourceProfile === 'en' && !isRecognizerComplete;
  const fallbackScanCandidates =
    shouldUseLegacyFullMountedScan
      ? (params.db.listProjectTermEntries(params.projectId) as ProjectTBEntry[])
      : [];
  const serviceCandidateSet =
    sourceProfile === 'en'
      ? uniqueProjectTBEntries([
          ...recognizerEntries,
          ...(wouldQueryDbFallback ? repoCandidates : []),
        ])
      : repoCandidates.length > 0
        ? repoCandidates
        : fallbackScanCandidates;
  const candidateFinalMatching =
    sourceProfile === 'en'
      ? traceEnglishCandidateFinalMatching({
          sourceText,
          hardBoundaryOffsets: serializedSearchText.hardBoundaryOffsets,
          candidates: serviceCandidateSet,
        })
      : traceLegacyCandidateFinalMatching({
          sourceText,
          srcLang: project.srcLang,
          candidates: serviceCandidateSet,
        });
  const finalMatches = await service.findMatches(params.projectId, segment);
  const focusSrcTerms = params.focusSrcTerms ?? [];
  const focusTgtTerms = params.focusTgtTerms ?? [];
  const focusEntriesInMountedTBs = collectFocusEntriesFromMountedTBs(
    params.db,
    mountedTBs,
    focusSrcTerms,
    focusTgtTerms,
  );
  const focusRepoCandidates = repoCandidates.filter((entry) =>
    matchesFocus(entry, focusSrcTerms, focusTgtTerms),
  );
  const focusFinalMatches = finalMatches.filter((match) =>
    matchesFocus(match, focusSrcTerms, focusTgtTerms),
  );

  return {
    scenario: {
      name: params.scenarioName ?? 'active TB match trace',
      focusSrcTerms,
      focusTgtTerms,
    },
    step0Project: {
      id: project.id,
      name: project.name,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      sourceProfile,
    },
    step0MountedTBs: mountedTBs.map((tb) => ({
      id: tb.id,
      name: tb.name,
      srcLang: tb.srcLang,
      tgtLang: tb.tgtLang,
      priority: tb.priority,
      isEnabled: tb.isEnabled,
      stats: params.db.getTermBaseStats(tb.id),
    })),
    step1SourceText: {
      sourceText,
      sourceLength: Array.from(sourceText).length,
      tokenCount: segment.sourceTokens.length,
    },
    step2SearchPlan: {
      ftsFragments: searchPlan.ftsFragments,
      exactLookupTerms: searchPlan.exactLookupTerms,
    },
    step3RepoCandidateRecall: {
      count: repoCandidates.length,
      candidates: repoCandidates.map(summarizeEntry),
      focusCandidates: focusRepoCandidates.map(summarizeEntry),
    },
    step4FallbackScan: {
      wouldUseFullMountedScan: shouldUseLegacyFullMountedScan,
      wouldQueryDbFallback,
      isRecognizerComplete,
      count: fallbackScanCandidates.length,
      focusEntriesInMountedTBs: focusEntriesInMountedTBs.map(summarizeEntry),
    },
    step5CandidateFinalMatching: candidateFinalMatching,
    step6FinalMatches: {
      count: finalMatches.length,
      matches: finalMatches.map(summarizeMatch),
      focusMatches: focusFinalMatches.map(summarizeMatch),
    },
  };
}

function readTraceEnvConfig(env: NodeJS.ProcessEnv): TraceEnvConfig | null {
  if (env.TB_MATCH_FLOW_DYNAMIC !== '1') return null;

  const projectId = Number(env.TB_MATCH_FLOW_PROJECT_ID);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error('TB_MATCH_FLOW_PROJECT_ID must be a positive integer.');
  }

  const source = cleanTraceText(env.TB_MATCH_FLOW_SOURCE);
  const segmentId = cleanTraceText(env.TB_MATCH_FLOW_SEGMENT_ID);
  if (!source && !segmentId) {
    throw new Error('Set TB_MATCH_FLOW_SOURCE or TB_MATCH_FLOW_SEGMENT_ID for dynamic tracing.');
  }
  if (source && segmentId) {
    throw new Error('Set only one of TB_MATCH_FLOW_SOURCE or TB_MATCH_FLOW_SEGMENT_ID.');
  }

  return {
    dbPath: env.TB_MATCH_FLOW_DB_PATH || '.cat_data/cat_v1.db',
    projectId,
    source,
    segmentId,
    focusSrcTerms: parseTraceList(env.TB_MATCH_FLOW_FOCUS_SRC_TERM),
    focusTgtTerms: parseTraceList(env.TB_MATCH_FLOW_FOCUS_TGT_TERM),
  };
}

async function runEnvConfiguredTrace(config: TraceEnvConfig) {
  const db = new CATDatabase(config.dbPath);
  try {
    const segment = config.segmentId ? db.getSegment(config.segmentId) : createSegment(config.source ?? '');
    if (!segment) {
      throw new Error(`Segment not found: ${config.segmentId}`);
    }

    const trace = await traceTBMatchFlow({
      db,
      projectId: config.projectId,
      segment,
      focusSrcTerms: config.focusSrcTerms,
      focusTgtTerms: config.focusTgtTerms,
      scenarioName: 'env-configured active TB match trace',
    });

    if (process.env.TB_MATCH_FLOW_TRACE === '1') {
      console.info(`[TB match flow trace]\n${JSON.stringify(trace, null, 2)}`);
    }

    return trace;
  } finally {
    db.close();
  }
}

describe('TB match flow trace', () => {
  it('shows a focused English term through candidate recall and final matching', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace English TB Match', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-heritage-wings',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'Heritage Wings',
        tgtTerm: 'patriaigle',
      });

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        source:
          'Heritage Wings are visionaries soaring across the vast skies. Their solitary flight path is a declaration.',
        focusSrcTerms: ['Heritage Wings'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual([
        'Heritage Wings',
      ]);
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.tgtTerm)).toEqual([
        'patriaigle',
      ]);
    } finally {
      db.close();
    }
  });

  it('recalls English profile alias candidates before final matching', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace English Alias TB Match', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Alias Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-account',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-real-time',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'real time',
        tgtTerm: 'temps reel',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-us',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'US',
        tgtTerm: 'Etats-Unis',
      });

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        source: 'Accounts use real-time U.S. settings.',
        focusSrcTerms: ['account', 'real time', 'US'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual(
        expect.arrayContaining(['account', 'real time', 'US']),
      );
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.srcTerm)).toEqual(
        expect.arrayContaining(['account', 'real time', 'US']),
      );
    } finally {
      db.close();
    }
  });

  it('recalls English multi-word final-word plurals through repo candidates', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace English Multi Word Plurals', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Multi Word Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-nela-bird',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'Nela Bird',
        tgtTerm: 'oiseau Nela',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-masquerade-lynx',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'Masquerade Lynx',
        tgtTerm: 'lynx masque',
      });

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        source: 'Nela Birds and Masquerade Lynxes appear.',
        focusSrcTerms: ['Nela Bird', 'Masquerade Lynx'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual(
        expect.arrayContaining(['Nela Bird', 'Masquerade Lynx']),
      );
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.srcTerm)).toEqual(
        expect.arrayContaining(['Nela Bird', 'Masquerade Lynx']),
      );
    } finally {
      db.close();
    }
  });

  it('keeps exact alias candidates ahead of noisy FTS recall before final matching', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace English Exact Candidate Limit', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Exact Candidate Limit Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (let index = 0; index < 220; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-noisy-fts-candidate-${index}`,
          tbId,
          srcLang: 'en-US',
          srcTerm: `The Very Long Noise Candidate ${String(index).padStart(3, '0')}`,
          tgtTerm: `bruit ${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-emberpaw',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'Emberpaw',
        tgtTerm: 'braisepatte',
      });

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        source: 'Emberpaws the',
        focusSrcTerms: ['Emberpaw'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual([
        'Emberpaw',
      ]);
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.srcTerm)).toEqual([
        'Emberpaw',
      ]);
    } finally {
      db.close();
    }
  });

  it('uses English alias recall for non-CJK project source locales', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace French TB Match Guard', 'fr-FR', 'en-US');
      const tbId = db.createTermBase('French Terms', 'fr-FR', 'en-US');
      db.mountTermBaseToProject(projectId, tbId, 1);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-french-account-guard',
        tbId,
        srcLang: 'fr-FR',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        source: 'Accounts are synced.',
        focusSrcTerms: ['account'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual([
        'account',
      ]);
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.srcTerm)).toEqual([
        'account',
      ]);
    } finally {
      db.close();
    }
  });

  it('does not mark English trace candidates accepted across protected tag boundaries', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace English Boundary Guard', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Boundary Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-api-key-boundary',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'API key',
        tgtTerm: 'cle API',
      });

      const segment = createSegment('API key');
      segment.sourceTokens = [
        { type: 'text', content: 'API' },
        { type: 'tag', content: '{1}', meta: { id: '{1}' } },
        { type: 'text', content: 'key' },
      ];

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        segment,
        focusSrcTerms: ['API key'],
      });

      expect(trace.step5CandidateFinalMatching).toEqual([
        expect.objectContaining({
          srcTerm: 'API key',
          accepted: false,
          droppedAt: 'noFinalTermPosition',
        }),
      ]);
      expect(trace.step6FinalMatches.focusMatches).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('recalls CJK terms across tag boundaries in long source text', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace CJK Garden TB Match', 'zh-CN', 'fr-FR');
      const tbId = db.createTermBase('Garden CJK Terms', 'zh-CN', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (const entry of [
        ['tb-garden-shop', '喵居商店', 'Boutique Miaou Maison'],
        ['tb-swap-cat', '交换喵', 'Chat Échangeur'],
        ['tb-snack-cat', '偷吃喵', 'Chat Gourmand'],
        ['tb-dried-fish', '小鱼干', 'Petit Poisson Séché'],
      ] as const) {
        const [id, srcTerm, tgtTerm] = entry;
        db.insertTBEntryIfAbsentBySrcTerm({
          id,
          tbId,
          srcLang: 'zh-CN',
          srcTerm,
          tgtTerm,
        });
      }

      const segment: Segment = {
        segmentId: 'tb-garden-cjk-coverage',
        fileId: 1,
        orderIndex: 0,
        sourceTokens: [
          {
            type: 'text',
            content:
              '1.划动荧幕时，使木架上所有小鱼干向指定方向移动{1}{1}2.每次移动会随机出现新的一个数量为2或4的小鱼干{1}{1}3.相同数量的小鱼干移动相碰时会合成升级为更多数量的小鱼干{1}{1}4.小游戏中可以使用道具来帮助整理小鱼干：{1}（1）交换喵：选中任意两个上下或左右相邻的小鱼干后，可以使其相互交换位置{1}（2）偷吃喵：选中任意一个小鱼干，可以让橘喵将它偷走吃掉{1}（3）每局游戏中每种道具最多可使用3次{1}（4）小游戏道具可通过喵居商店购买获得',
          },
          { type: 'tag', content: '{1}', meta: { id: '{1}' } },
          { type: 'tag', content: '{1}', meta: { id: '{1}' } },
          {
            type: 'text',
            content:
              '5.当任意单个小鱼干达到指定数量时，会使本局喵币的奖励翻倍{1}{1}6.结算时根据木架内整理的所有小鱼干数量来获得对应的游戏分数，并通过游戏分数计算得到喵币{1}{1}7.单局分数低于10分无法获得喵币奖励',
          },
        ],
        targetTokens: [],
        status: 'new',
        tagsSignature: '{1}',
        matchKey: 'tb-garden-cjk-coverage',
        srcHash: 'tb-garden-cjk-coverage',
        meta: { updatedAt: new Date().toISOString() },
      };

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        segment,
        focusSrcTerms: ['喵居商店'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual([
        '喵居商店',
      ]);
      expect(trace.step4FallbackScan.wouldUseFullMountedScan).toBe(false);
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.tgtTerm)).toEqual([
        'Boutique Miaou Maison',
      ]);
    } finally {
      db.close();
    }
  });

  it('tb-flow-env-trace', async () => {
    const config = readTraceEnvConfig(process.env);
    if (!config) return;

    const trace = await runEnvConfiguredTrace(config);

    expect(trace.step1SourceText.sourceText.length).toBeGreaterThan(0);
  });
});
