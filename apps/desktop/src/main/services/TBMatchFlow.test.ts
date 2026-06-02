import { describe, expect, it } from 'vitest';
import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  buildTermSearchPlanForLocale,
  findTermPositionsInTextForLocale,
  normalizeTermForLookup,
  serializeTokensToSearchText,
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

function traceCandidateFinalMatching(params: {
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
  const sourceText = serializeTokensToSearchText(segment.sourceTokens);
  const mountedTBs = params.db.getProjectMountedTermBases(params.projectId);
  const searchPlan = buildTermSearchPlanForLocale(sourceText, {
    locale: project.srcLang,
    maxFragments: 36,
  });
  const repoCandidates = params.db.searchProjectTermEntries(params.projectId, sourceText, {
    srcLang: project.srcLang,
    limit: TB_CANDIDATE_LIMIT,
  }) as ProjectTBEntry[];
  const fallbackScanCandidates =
    repoCandidates.length === 0
      ? (params.db.listProjectTermEntries(params.projectId) as ProjectTBEntry[])
      : [];
  const serviceCandidateSet =
    repoCandidates.length > 0 ? repoCandidates : fallbackScanCandidates;
  const candidateFinalMatching = traceCandidateFinalMatching({
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
      wouldUseFullMountedScan: repoCandidates.length === 0,
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

  it('does not use English alias recall for non-English project source locale', async () => {
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

      expect(trace.step3RepoCandidateRecall.focusCandidates).toEqual([]);
      expect(trace.step6FinalMatches.focusMatches).toEqual([]);
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
