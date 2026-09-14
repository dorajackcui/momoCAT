import type Database from 'better-sqlite3';
import { hasEnglishTMConcordanceEvidence } from '@cat/core/text';
import type { MountedTMRecord, TMEntryRow, TMConcordanceRecallOptions } from '../../types';
import { mapTMEntryDbRow, type TMRecallDbRow } from './tmEntryRows';
import {
  buildFtsRecallQuery,
  chunkTerms,
  escapeLikePattern,
  uniqueTerms,
  WEAK_SHORT_CJK_TERMS,
} from './tmRecallQuery';
import { diversifyRecallRows } from './tmRecallDiversity';
import {
  buildTMConcordanceRecallQueryPlan,
  hasConcordanceRecallEvidence,
  type TMConcordanceRecallQueryPlan,
} from './tmConcordancePolicy';

interface TMConcordanceRecallStats {
  ftsQueryCount: number;
  rawRows: number;
  acceptedRows: number;
  degraded: boolean;
  elapsedMs: number;
}

const TM_CONCORDANCE_RECALL_DEFAULT_LIMIT = 50;
const TM_CONCORDANCE_RECALL_MAX_LIMIT = 50;
const TM_CONCORDANCE_RECALL_RAW_LIMIT = 200;
const TM_CONCORDANCE_RECALL_BATCH_SIZE = 32;
const TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS = 50;
const TM_CONCORDANCE_RECALL_RAW_LIMIT_MAX = 1000;
const TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT = 64;
const TM_CONCORDANCE_RECALL_EXACT_SOURCE_LIMIT = 64;
const TM_CONCORDANCE_RECALL_ENGLISH_EXACT_PHRASE_RAW_LIMIT = 8;

/** Source-side concordance collection with bounded SQL, raw rows, and elapsed time. */
export class TMConcordanceRecall {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectMountedTMs: (projectId: number) => MountedTMRecord[],
  ) {}

  public searchTMConcordanceRecallCandidates(
    projectId: number,
    queryText: string,
    tmIds?: string[],
    options: TMConcordanceRecallOptions = {},
  ): TMEntryRow[] {
    const startedAt = Date.now();
    const stats: TMConcordanceRecallStats = {
      ftsQueryCount: 0,
      rawRows: 0,
      acceptedRows: 0,
      degraded: false,
      elapsedMs: 0,
    };
    const maxResults = Math.min(
      Math.max(options.limit ?? TM_CONCORDANCE_RECALL_DEFAULT_LIMIT, 0),
      TM_CONCORDANCE_RECALL_MAX_LIMIT,
    );
    if (maxResults === 0) return [];

    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) return [];

    const plan = buildTMConcordanceRecallQueryPlan(queryText, options.profile);
    const rawLimit = this.clampConcordanceRawLimit(options.rawLimit, maxResults);
    const rows = this.collectConcordanceRecallRows({
      tmIds: resolvedTmIds,
      queryText,
      plan,
      profile: options.profile,
      maxResults: rawLimit,
      rawLimit,
      stats,
      startedAt,
    });
    const diversified = diversifyRecallRows(queryText, rows, maxResults, 'source');

    stats.elapsedMs = Date.now() - startedAt;
    this.logRecallDebug('concordance recall', {
      projectId,
      tmCount: resolvedTmIds.length,
      queryLength: Array.from(queryText).length,
      ...stats,
    });

    return diversified.map((row) => mapTMEntryDbRow(row));
  }

  private collectConcordanceRecallRows(params: {
    tmIds: string[];
    queryText: string;
    plan: TMConcordanceRecallQueryPlan;
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    startedAt: number;
  }): TMRecallDbRow[] {
    const accepted: TMRecallDbRow[] = [];
    const seenIds = new Set<string>();
    const tiers = [
      [...params.plan.cjk4Fragments, ...params.plan.latinTerms, ...params.plan.englishTerms],
      params.plan.longCjkFragments,
      params.plan.cjk3Fragments,
    ];

    this.collectConcordanceEnglishExactSourcePhraseTier({
      ...params,
      accepted,
      seenIds,
    });

    this.collectConcordanceExactSourceTier({
      ...params,
      accepted,
      seenIds,
    });

    if (accepted.length < params.maxResults && params.stats.rawRows < params.rawLimit) {
      this.collectConcordanceFtsBatchTier({
        ...params,
        terms: params.plan.englishFtsPhrases,
        accepted,
        seenIds,
      });
    }

    for (let index = 0; index < tiers.length; index += 1) {
      if (accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) break;
      if (index > 0 && Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS) {
        params.stats.degraded = true;
        break;
      }

      this.collectConcordanceFtsBatchTier({
        ...params,
        terms: tiers[index],
        accepted,
        seenIds,
      });
    }

    if (
      accepted.length < params.maxResults &&
      params.stats.rawRows < params.rawLimit &&
      !params.stats.degraded
    ) {
      this.collectConcordanceLikeTier({
        ...params,
        accepted,
        seenIds,
      });
    }

    return accepted;
  }

  private collectConcordanceExactSourceTier(params: {
    tmIds: string[];
    queryText: string;
    plan: TMConcordanceRecallQueryPlan;
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
  }): void {
    const terms = uniqueTerms([
      ...params.plan.shortCjkTerms,
      ...params.plan.cjk3Fragments,
      ...params.plan.cjk4Fragments,
      ...params.plan.longCjkFragments,
    ]).filter((term) => term.length >= 2);
    this.collectConcordanceExactSourceTermsTier({
      ...params,
      terms,
    });
  }

  private collectConcordanceEnglishExactSourcePhraseTier(params: {
    tmIds: string[];
    queryText: string;
    plan: TMConcordanceRecallQueryPlan;
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
  }): void {
    this.collectConcordanceExactSourceTermsTier({
      ...params,
      terms: params.plan.englishExactPhrases,
      rawLimitCap: this.getEnglishExactPhraseRawLimitCap(params.rawLimit, params.stats.rawRows),
    });
  }

  private collectConcordanceExactSourceTermsTier(params: {
    tmIds: string[];
    queryText: string;
    terms: string[];
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    rawLimitCap?: number;
  }): void {
    if (params.accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) {
      return;
    }

    const terms = uniqueTerms(params.terms).filter((term) => term.length >= 2);
    if (terms.length === 0) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const termPlaceholders = terms.map(() => '?').join(',');
    const remainingRaw = Math.min(
      params.rawLimit - params.stats.rawRows,
      params.maxResults - params.accepted.length,
      params.rawLimitCap ?? Number.POSITIVE_INFINITY,
      TM_CONCORDANCE_RECALL_EXACT_SOURCE_LIMIT,
    );
    if (remainingRaw <= 0) return;

    const rows = this.db
      .prepare(
        `
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts.srcText IN (${termPlaceholders})
        ORDER BY length(tm_fts.srcText) ASC, tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
        LIMIT ?
      `,
      )
      .all(...params.tmIds, ...terms, remainingRaw) as TMRecallDbRow[];

    params.stats.rawRows += rows.length;
    this.acceptConcordanceRecallRows({
      queryText: params.queryText,
      rows,
      accepted: params.accepted,
      seenIds: params.seenIds,
      maxResults: params.maxResults,
      stats: params.stats,
      profile: params.profile,
    });
  }

  private getEnglishExactPhraseRawLimitCap(rawLimit: number, rawRows: number): number {
    const remainingRaw = rawLimit - rawRows;
    if (remainingRaw <= 1) return remainingRaw;

    return Math.max(
      1,
      Math.min(
        TM_CONCORDANCE_RECALL_ENGLISH_EXACT_PHRASE_RAW_LIMIT,
        Math.ceil(rawLimit / 2),
        remainingRaw - 1,
      ),
    );
  }

  private collectConcordanceFtsBatchTier(params: {
    tmIds: string[];
    queryText: string;
    terms: string[];
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    startedAt: number;
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
  }): void {
    const terms = uniqueTerms(params.terms).filter((term) => term.length >= 3);
    if (terms.length === 0) return;

    const batches = chunkTerms(terms, TM_CONCORDANCE_RECALL_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (params.accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) {
        break;
      }
      if (batchIndex > 0 && Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS) {
        params.stats.degraded = true;
        break;
      }

      const batch = batches[batchIndex];
      const placeholders = params.tmIds.map(() => '?').join(',');
      const ftsQuery = buildFtsRecallQuery(batch, 'source');
      const remainingRaw = Math.min(
        params.rawLimit - params.stats.rawRows,
        TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT,
      );
      if (remainingRaw <= 0) break;
      params.stats.ftsQueryCount += 1;
      const rows = this.db
        .prepare(
          `
          SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
          FROM tm_fts
          JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
          WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
          ORDER BY rank, tm_entries.updatedAt DESC, tm_entries.id ASC
          LIMIT ?
        `,
        )
        .all(...params.tmIds, ftsQuery, remainingRaw) as TMRecallDbRow[];

      params.stats.rawRows += rows.length;
      this.acceptConcordanceRecallRows({
        queryText: params.queryText,
        rows,
        accepted: params.accepted,
        seenIds: params.seenIds,
        maxResults: params.maxResults,
        stats: params.stats,
        profile: params.profile,
      });
      if (
        batchIndex < batches.length - 1 &&
        Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS
      ) {
        params.stats.degraded = true;
        break;
      }
    }
  }

  private collectConcordanceLikeTier(params: {
    tmIds: string[];
    queryText: string;
    plan: TMConcordanceRecallQueryPlan;
    profile?: 'english';
    maxResults: number;
    rawLimit: number;
    stats: TMConcordanceRecallStats;
    startedAt: number;
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
  }): void {
    const terms = uniqueTerms(params.plan.shortCjkTerms).filter(
      (term) => term.length === 2 && !WEAK_SHORT_CJK_TERMS.has(term),
    );
    if (terms.length === 0) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const batches = chunkTerms(terms, TM_CONCORDANCE_RECALL_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (params.accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) {
        break;
      }
      if (batchIndex > 0 && Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS) {
        params.stats.degraded = true;
        break;
      }

      const batch = batches[batchIndex];
      const likeClauses = batch.map(() => "(tm_fts.srcText LIKE ? ESCAPE '/')").join(' OR ');
      const likeParams = batch.map((term) => `%${escapeLikePattern(term)}%`);
      const remainingRaw = Math.min(
        params.rawLimit - params.stats.rawRows,
        TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT,
      );
      if (remainingRaw <= 0) break;
      const rows = this.db
        .prepare(
          `
          SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
          FROM tm_fts
          JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
          WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
          ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
          LIMIT ?
        `,
        )
        .all(...params.tmIds, ...likeParams, remainingRaw) as TMRecallDbRow[];

      params.stats.rawRows += rows.length;
      this.acceptConcordanceRecallRows({
        queryText: params.queryText,
        rows,
        accepted: params.accepted,
        seenIds: params.seenIds,
        maxResults: params.maxResults,
        stats: params.stats,
        profile: params.profile,
      });
      if (
        batchIndex < batches.length - 1 &&
        Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS
      ) {
        params.stats.degraded = true;
        break;
      }
    }
  }

  private acceptConcordanceRecallRows(params: {
    queryText: string;
    rows: TMRecallDbRow[];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
    stats: TMConcordanceRecallStats;
    profile?: 'english';
  }): void {
    for (const row of params.rows) {
      if (params.accepted.length >= params.maxResults) break;
      if (params.seenIds.has(row.id)) continue;
      const hasEvidence =
        params.profile === 'english'
          ? hasEnglishTMConcordanceEvidence(params.queryText, row.ftsSrcText)
          : hasConcordanceRecallEvidence(params.queryText, row);
      if (!hasEvidence) continue;

      params.seenIds.add(row.id);
      params.accepted.push(row);
      params.stats.acceptedRows += 1;
    }
  }

  private clampConcordanceRawLimit(rawLimit: number | undefined, minResults: number): number {
    const candidate = Number.isFinite(rawLimit)
      ? Math.floor(rawLimit as number)
      : TM_CONCORDANCE_RECALL_RAW_LIMIT;
    return Math.min(Math.max(candidate, minResults), TM_CONCORDANCE_RECALL_RAW_LIMIT_MAX);
  }

  private logRecallDebug(message: string, payload: Record<string, unknown>): void {
    if (process.env.CAT_TM_RECALL_DEBUG !== '1') return;
    console.debug(`[TM recall] ${message}`, payload);
  }
}
