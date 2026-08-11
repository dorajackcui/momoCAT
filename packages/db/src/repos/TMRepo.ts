import Database from 'better-sqlite3';
import type { TMEntry, Token } from '@cat/core/models';
import {
  buildEnglishTMConcordancePhraseTerms,
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
} from '@cat/core/text';
import { randomUUID } from 'crypto';
import type {
  MountedTMRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMSyncChangedRow,
  TMSyncDiffSummary,
  TMSyncStagedRow,
  TMType,
} from '../types';

type TMEntryDbRow = Omit<TMEntryRow, 'sourceTokens' | 'targetTokens'> & {
  sourceTokensJson: string;
  targetTokensJson: string;
};

type TMRecallDbRow = TMEntryDbRow & {
  ftsSrcText: string;
  ftsTgtText: string;
};

interface TMRecallQueryPlan {
  exactTerms: string[];
  primaryCjkFragments: string[];
  secondaryCjkFragments: string[];
  shortCjkTerms: string[];
  latinTerms: string[];
  englishTerms: string[];
  englishShortAcronymTerms: string[];
}

interface TMConcordanceRecallQueryPlan {
  cjk4Fragments: string[];
  cjk3Fragments: string[];
  longCjkFragments: string[];
  latinTerms: string[];
  shortCjkTerms: string[];
  englishExactPhrases: string[];
  englishFtsPhrases: string[];
  englishTerms: string[];
}

interface TMConcordanceRecallStats {
  ftsQueryCount: number;
  rawRows: number;
  acceptedRows: number;
  degraded: boolean;
  elapsedMs: number;
}

interface TMFtsReplacementRow {
  tmId: string;
  srcText: string;
  tgtText: string;
  tmEntryId: string;
}

const TM_RECALL_DEFAULT_LIMIT = 50;
const TM_RECALL_MAX_LIMIT = 50;
const TM_RECALL_DIVERSITY_POOL_MULTIPLIER = 3;
const TM_RECALL_PRIMARY_FRAGMENT_LIMIT = 16;
const TM_RECALL_SECONDARY_FRAGMENT_LIMIT = 12;
const TM_RECALL_SHORT_TERM_LIMIT = 4;
const TM_RECALL_SHORT_ROW_LIMIT = 10;
const TM_RECALL_SECONDARY_TRIGGER = 8;
const TM_RECALL_SHORT_TRIGGER = 6;
const TM_CONCORDANCE_RESULT_LIMIT = 10;
const TM_CONCORDANCE_RECALL_DEFAULT_LIMIT = 50;
const TM_CONCORDANCE_RECALL_MAX_LIMIT = 50;
const TM_CONCORDANCE_RECALL_RAW_LIMIT = 200;
const TM_CONCORDANCE_RECALL_BATCH_SIZE = 32;
const TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS = 50;
const TM_CONCORDANCE_RECALL_CJK4_LIMIT = 64;
const TM_CONCORDANCE_RECALL_CJK3_LIMIT = 48;
const TM_CONCORDANCE_RECALL_CJK_LONG_LIMIT = 32;
const TM_CONCORDANCE_RECALL_LATIN_LIMIT = 32;
const TM_CONCORDANCE_RECALL_SHORT_CJK_LIMIT = 16;
const TM_CONCORDANCE_RECALL_RAW_LIMIT_MAX = 1000;
const TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT = 64;
const TM_CONCORDANCE_RECALL_EXACT_SOURCE_LIMIT = 64;
const TM_CONCORDANCE_RECALL_ENGLISH_EXACT_PHRASE_RAW_LIMIT = 8;
const TM_RECALL_DIVERSITY_MAX_PER_BUCKET = 2;
const TM_RECALL_DIVERSITY_MIN_CJK_BUCKET_LENGTH = 4;
const TM_FTS_REPLACE_DELETE_BATCH_SIZE = 900;
// FTS5 incremental merge: pages written per 'merge' step, and the max steps
// one optimizeTMFts call may run. 16 pages/step keeps each step a few ms;
// 64 rounds bounds a single call to ~1k pages of work regardless of how
// fragmented the index is (leftovers roll over to the next call).
const TM_FTS_MERGE_STEP_PAGES = 16;
const TM_FTS_MERGE_MAX_ROUNDS = 64;
// Rows per multi-row VALUES in sync staging/insert batches. 9 bind params per
// staging row keeps 500 rows well under SQLITE_MAX_VARIABLE_NUMBER (32766).
const TM_SYNC_INSERT_BATCH_SIZE = 500;
const ONLY_CJK_RE = /^[一-龥]+$/;
const WEAK_SHORT_CJK_TERMS = new Set(['前往', '可选']);

export class TMRepo {
  private stmtUpsertTMEntry: Database.Statement;
  private stmtInsertTMEntryIfAbsentBySrcHash: Database.Statement;
  private stmtUpsertTMEntryBySrcHash: Database.Statement;
  private stmtDeleteTMFtsByEntryId: Database.Statement;
  private stmtInsertTMFts: Database.Statement;
  private stmtFindTMEntryByHash: Database.Statement;
  private stmtFindTMEntryMetaByHash: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtUpsertTMEntry = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        targetTokensJson = excluded.targetTokensJson,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = usageCount + 1
    `);

    this.stmtInsertTMEntryIfAbsentBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO NOTHING
      RETURNING id
    `);

    this.stmtUpsertTMEntryBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO UPDATE SET
        matchKey = excluded.matchKey,
        tagsSignature = excluded.tagsSignature,
        sourceTokensJson = excluded.sourceTokensJson,
        targetTokensJson = excluded.targetTokensJson,
        originSegmentId = excluded.originSegmentId,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = tm_entries.usageCount + 1
      RETURNING id
    `);

    this.stmtDeleteTMFtsByEntryId = this.db.prepare('DELETE FROM tm_fts WHERE tmEntryId = ?');
    this.stmtInsertTMFts = this.db.prepare(
      'INSERT INTO tm_fts (tmId, srcText, tgtText, tmEntryId) VALUES (?, ?, ?, ?)'
    );
    this.stmtFindTMEntryByHash = this.db.prepare('SELECT * FROM tm_entries WHERE tmId = ? AND srcHash = ?');
    this.stmtFindTMEntryMetaByHash = this.db.prepare(
      'SELECT id, usageCount, createdAt FROM tm_entries WHERE tmId = ? AND srcHash = ?'
    );
  }

  // --- tm_fts row bookkeeping ---
  //
  // tmEntryId is UNINDEXED in the FTS5 table, so deleting by it scans every
  // document. tm_entries.ftsRowid remembers each entry's FTS rowid so
  // replace/delete paths are O(log n) instead. Prepared lazily: ftsRowid is an
  // additive column created by schema maintenance, which readonly connections
  // skip.

  private stmtGetTMEntryFtsRowid?: Database.Statement;
  private stmtSetTMEntryFtsRowid?: Database.Statement;
  private stmtDeleteTMFtsByRowid?: Database.Statement;

  private insertTMFtsForEntry(
    tmId: string,
    srcText: string,
    tgtText: string,
    tmEntryId: string,
  ): void {
    const info = this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
    this.stmtSetTMEntryFtsRowid ??= this.db.prepare(
      'UPDATE tm_entries SET ftsRowid = ? WHERE id = ?',
    );
    this.stmtSetTMEntryFtsRowid.run(info.lastInsertRowid, tmEntryId);
  }

  private deleteTMFtsForEntry(tmEntryId: string): void {
    this.stmtGetTMEntryFtsRowid ??= this.db.prepare(
      'SELECT ftsRowid FROM tm_entries WHERE id = ?',
    );
    const row = this.stmtGetTMEntryFtsRowid.get(tmEntryId) as
      | { ftsRowid: number | null }
      | undefined;
    // NULL/0: no FTS row recorded for this entry (fresh insert, or an entry
    // that never had one) — nothing to delete.
    if (!row?.ftsRowid) return;

    this.stmtDeleteTMFtsByRowid ??= this.db.prepare(
      'DELETE FROM tm_fts WHERE rowid = ? AND tmEntryId = ?',
    );
    const result = this.stmtDeleteTMFtsByRowid.run(row.ftsRowid, tmEntryId);
    if (result.changes === 0) {
      // Stale mapping (e.g. the row was rewritten by an app version that
      // predates ftsRowid): fall back to the full-scan delete.
      this.stmtDeleteTMFtsByEntryId.run(tmEntryId);
    }
  }

  public upsertTMEntry(entry: TMEntry & { tmId: string }) {
    this.stmtUpsertTMEntry.run(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    );

    const srcText = entry.sourceTokens.map((token: Token) => token.content).join('');
    const tgtText = entry.targetTokens.map((token: Token) => token.content).join('');

    this.deleteTMFtsForEntry(entry.id);
    this.insertTMFtsForEntry(entry.tmId, srcText, tgtText, entry.id);
  }

  public insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined {
    const row = this.stmtInsertTMEntryIfAbsentBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    ) as { id: string } | undefined;

    return row?.id;
  }

  public upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    const row = this.stmtUpsertTMEntryBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    ) as { id: string } | undefined;

    if (!row?.id) {
      throw new Error('Failed to upsert TM entry by srcHash');
    }

    return row.id;
  }

  public insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.insertTMFtsForEntry(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.deleteTMFtsForEntry(tmEntryId);
    this.insertTMFtsForEntry(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFtsBatch(rows: TMFtsReplacementRow[]) {
    const replacements = this.dedupeTMFtsReplacementRows(rows);
    if (replacements.length === 0) return;

    const replaceRows = () => {
      for (const row of replacements) {
        this.deleteTMFtsForEntry(row.tmEntryId);
        this.insertTMFtsForEntry(row.tmId, row.srcText, row.tgtText, row.tmEntryId);
      }
    };

    if (this.db.inTransaction) {
      replaceRows();
      return;
    }

    this.db.transaction(replaceRows)();
  }

  public findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    const row = this.stmtFindTMEntryByHash.get(tmId, srcHash) as TMEntryDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson)
    };
  }

  public findTMEntryMetaByHash(
    tmId: string,
    srcHash: string
  ): { id: string; usageCount: number; createdAt: string } | undefined {
    const row = this.stmtFindTMEntryMetaByHash.get(tmId, srcHash) as
      | { id: string; usageCount: number; createdAt: string }
      | undefined;
    return row;
  }

  public getProjectMountedTMs(projectId: number): MountedTMRecord[] {
    return this.db
      .prepare(`
      SELECT tms.*, project_tms.priority, project_tms.permission, project_tms.isEnabled
      FROM project_tms
      JOIN tms ON project_tms.tmId = tms.id
      WHERE project_tms.projectId = ? AND project_tms.isEnabled = 1
      ORDER BY project_tms.priority ASC
    `)
      .all(projectId) as MountedTMRecord[];
  }

  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    return this.searchTMFuzzyRecallCandidates(projectId, sourceText, tmIds, options);
  }

  public searchTMFuzzyRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    const maxResults = Math.min(
      Math.max(options.limit ?? TM_RECALL_DEFAULT_LIMIT, 0),
      TM_RECALL_MAX_LIMIT,
    );
    if (maxResults === 0) return [];

    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) return [];

    const plan = this.buildTMRecallQueryPlan(sourceText, options.profile);
    const accepted: TMRecallDbRow[] = [];
    const seenIds = new Set<string>();
    const scope = options.scope ?? 'source';
    const collectionLimit = Math.min(
      maxResults * TM_RECALL_DIVERSITY_POOL_MULTIPLIER,
      TM_RECALL_MAX_LIMIT * TM_RECALL_DIVERSITY_POOL_MULTIPLIER,
    );

    this.collectFtsRecallTier({
      tmIds: resolvedTmIds,
      terms: [...plan.exactTerms, ...plan.latinTerms, ...plan.englishTerms],
      sourceText,
      plan,
      scope,
      accepted,
      seenIds,
      maxResults: collectionLimit,
      allowShortOnly: false,
    });

    if (accepted.length < collectionLimit) {
      this.collectFtsRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.primaryCjkFragments,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults: collectionLimit,
        allowShortOnly: false,
      });
    }

    if (accepted.length < Math.min(collectionLimit, TM_RECALL_SECONDARY_TRIGGER)) {
      this.collectFtsRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.secondaryCjkFragments,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults: collectionLimit,
        allowShortOnly: false,
      });
    }

    if (accepted.length < Math.min(collectionLimit, TM_RECALL_SHORT_TRIGGER)) {
      this.collectEnglishShortAcronymExactSourceTier({
        tmIds: resolvedTmIds,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults: collectionLimit,
      });
    }

    if (accepted.length < Math.min(collectionLimit, TM_RECALL_SHORT_TRIGGER)) {
      this.collectLikeRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.shortCjkTerms,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults: collectionLimit,
      });
    }

    return this.diversifyRecallRows(sourceText, accepted, maxResults, scope).map((row) =>
      this.mapTMEntryDbRow(row),
    );
  }

  public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
    const candidates = this.searchTMRecallCandidates(projectId, query, tmIds, {
      scope: 'source-and-target',
      limit: TM_RECALL_MAX_LIMIT,
    });
    return this.diversifyConcordanceRows(query, candidates, TM_CONCORDANCE_RESULT_LIMIT);
  }

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

    const plan = this.buildTMConcordanceRecallQueryPlan(queryText, options.profile);
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
    const diversified = this.diversifyRecallRows(queryText, rows, maxResults, 'source');

    stats.elapsedMs = Date.now() - startedAt;
    this.logRecallDebug('concordance recall', {
      projectId,
      tmCount: resolvedTmIds.length,
      queryLength: Array.from(queryText).length,
      ...stats,
    });

    return diversified.map((row) => this.mapTMEntryDbRow(row));
  }

  private buildTMConcordanceRecallQueryPlan(
    queryText: string,
    profile?: 'english',
  ): TMConcordanceRecallQueryPlan {
    const terms = this.extractSearchTerms(queryText);
    const cjkComponents = this.uniqueTerms(terms.flatMap((term) => this.extractCjkComponents(term)));
    const cjk3 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 3));
    const cjk4 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 4));
    const cjk5 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 5));
    const cjk6 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 6));
    const cjk2 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 2));
    const englishPhraseTerms =
      profile === 'english'
        ? buildEnglishTMConcordancePhraseTerms(queryText)
        : { exactPhrases: [], ftsPhrases: [] };
    const englishTerms =
      profile === 'english'
        ? this.selectSpreadFragments(buildEnglishTMRecallTerms(queryText), 32)
        : [];

    return {
      cjk4Fragments: this.selectSpreadFragments(
        this.uniqueTerms(cjk4),
        TM_CONCORDANCE_RECALL_CJK4_LIMIT,
      ),
      cjk3Fragments: this.selectSpreadFragments(
        this.uniqueTerms(cjk3),
        TM_CONCORDANCE_RECALL_CJK3_LIMIT,
      ),
      longCjkFragments: this.selectSpreadFragments(
        this.uniqueTerms([...cjk5, ...cjk6]),
        TM_CONCORDANCE_RECALL_CJK_LONG_LIMIT,
      ),
      latinTerms: this.selectSpreadFragments(
        this.uniqueTerms(terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term))),
        TM_CONCORDANCE_RECALL_LATIN_LIMIT,
      ),
      shortCjkTerms: this.selectSpreadFragments(
        this.uniqueTerms(cjk2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
        TM_CONCORDANCE_RECALL_SHORT_CJK_LIMIT,
      ),
      englishExactPhrases: this.uniqueTerms(englishPhraseTerms.exactPhrases),
      englishFtsPhrases: this.uniqueTerms(englishPhraseTerms.ftsPhrases),
      englishTerms,
    };
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
    const terms = this.uniqueTerms([
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

    const terms = this.uniqueTerms(params.terms).filter((term) => term.length >= 2);
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
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts.srcText IN (${termPlaceholders})
        ORDER BY length(tm_fts.srcText) ASC, tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
        LIMIT ?
      `)
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
    const terms = this.uniqueTerms(params.terms).filter((term) => term.length >= 3);
    if (terms.length === 0) return;

    const batches = this.chunkTerms(terms, TM_CONCORDANCE_RECALL_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (params.accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) {
        break;
      }
      if (
        batchIndex > 0 &&
        Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS
      ) {
        params.stats.degraded = true;
        break;
      }

      const batch = batches[batchIndex];
      const placeholders = params.tmIds.map(() => '?').join(',');
      const ftsQuery = this.buildFtsRecallQuery(batch, 'source');
      const remainingRaw = Math.min(
        params.rawLimit - params.stats.rawRows,
        TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT,
      );
      if (remainingRaw <= 0) break;
      params.stats.ftsQueryCount += 1;
      const rows = this.db
        .prepare(`
          SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
          FROM tm_fts
          JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
          WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
          ORDER BY rank, tm_entries.updatedAt DESC, tm_entries.id ASC
          LIMIT ?
        `)
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
    const terms = this.uniqueTerms(params.plan.shortCjkTerms).filter(
      (term) => term.length === 2 && !WEAK_SHORT_CJK_TERMS.has(term),
    );
    if (terms.length === 0) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const batches = this.chunkTerms(terms, TM_CONCORDANCE_RECALL_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (params.accepted.length >= params.maxResults || params.stats.rawRows >= params.rawLimit) {
        break;
      }
      if (
        batchIndex > 0 &&
        Date.now() - params.startedAt > TM_CONCORDANCE_RECALL_SOFT_BUDGET_MS
      ) {
        params.stats.degraded = true;
        break;
      }

      const batch = batches[batchIndex];
      const likeClauses = batch.map(() => '(tm_fts.srcText LIKE ? ESCAPE \'/\')').join(' OR ');
      const likeParams = batch.map((term) => `%${this.escapeLikePattern(term)}%`);
      const remainingRaw = Math.min(
        params.rawLimit - params.stats.rawRows,
        TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT,
      );
      if (remainingRaw <= 0) break;
      const rows = this.db
        .prepare(`
          SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
          FROM tm_fts
          JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
          WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
          ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
          LIMIT ?
        `)
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
          : this.hasConcordanceRecallEvidence(params.queryText, row);
      if (!hasEvidence) continue;

      params.seenIds.add(row.id);
      params.accepted.push(row);
      params.stats.acceptedRows += 1;
    }
  }

  private hasConcordanceRecallEvidence(queryText: string, row: TMRecallDbRow): boolean {
    const normalizedQuery = this.normalizeForOverlap(queryText);
    const normalizedCandidate = this.normalizeForOverlap(row.ftsSrcText);
    const candidateChars = Array.from(normalizedCandidate);
    if (candidateChars.length === 0) return false;

    const overlap = this.findLongestCommonSubstring(normalizedQuery, normalizedCandidate);
    const overlapLength = Array.from(overlap).length;
    const candidateCjkLength = Array.from(
      normalizedCandidate.replace(/[^\u4e00-\u9fa5]/g, ''),
    ).length;

    if (
      this.isCjkWithBoundarySpaces(normalizedCandidate) &&
      candidateCjkLength >= 3 &&
      candidateCjkLength <= 8 &&
      this.containsWithTokenBoundary(normalizedQuery, normalizedCandidate)
    ) {
      return true;
    }

    if (
      this.isCjkWithBoundarySpaces(normalizedCandidate) &&
      candidateCjkLength === 2 &&
      this.getTotalCjkComponentLength(normalizedCandidate) <= 4 &&
      this.containsWithTokenBoundary(normalizedQuery, normalizedCandidate)
    ) {
      return true;
    }

    if (overlapLength >= 3) {
      const entryCoverage = Math.round((overlapLength / candidateChars.length) * 100);
      if (entryCoverage >= 90) return true;
    }

    return overlapLength >= 4;
  }

  private containsWithTokenBoundary(normalizedQuery: string, normalizedCandidate: string): boolean {
    return normalizedQuery.includes(normalizedCandidate);
  }

  private isCjkWithBoundarySpaces(text: string): boolean {
    return /^[\u4e00-\u9fa5 ]+$/.test(text);
  }

  private getTotalCjkComponentLength(text: string): number {
    return this.extractCjkComponents(text).reduce(
      (sum, component) => sum + Array.from(component).length,
      0,
    );
  }

  private collectFtsRecallTier(params: {
    tmIds: string[];
    terms: string[];
    sourceText: string;
    plan: TMRecallQueryPlan;
    scope: TMRecallOptions['scope'];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
    allowShortOnly: boolean;
  }): void {
    const terms = this.uniqueTerms(params.terms).filter((term) => term.length >= 3);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const ftsQuery = this.buildFtsRecallQuery(terms, params.scope ?? 'source');
    const rawLimit = Math.max(params.maxResults * 3, 20);

    const rows = this.db
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
        ORDER BY rank
        LIMIT ${rawLimit}
      `)
      .all(...params.tmIds, ftsQuery) as TMRecallDbRow[];

    for (const row of rows) {
      if (params.seenIds.has(row.id)) continue;
      if (
        !this.hasRecallEvidence({
          sourceText: params.sourceText,
          candidate: row,
          plan: params.plan,
          scope: params.scope ?? 'source',
          allowShortOnly: params.allowShortOnly,
        })
      ) {
        continue;
      }

      params.seenIds.add(row.id);
      params.accepted.push(row);
      if (params.accepted.length >= params.maxResults) break;
    }
  }

  private collectEnglishShortAcronymExactSourceTier(params: {
    tmIds: string[];
    sourceText: string;
    plan: TMRecallQueryPlan;
    scope: TMRecallOptions['scope'];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
  }): void {
    const terms = this.uniqueTerms(params.plan.englishShortAcronymTerms);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const forms = this.uniqueTerms(terms.flatMap((term) => this.buildShortAcronymRawForms(term)));
    if (forms.length === 0) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const formPlaceholders = forms.map(() => '?').join(',');
    const remaining = Math.min(params.maxResults - params.accepted.length, forms.length * 4);
    if (remaining <= 0) return;

    const rows = this.db
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts.srcText IN (${formPlaceholders})
        ORDER BY length(tm_fts.srcText) ASC, tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
        LIMIT ?
      `)
      .all(...params.tmIds, ...forms, remaining) as TMRecallDbRow[];

    for (const row of rows) {
      if (params.seenIds.has(row.id)) continue;
      if (
        !this.hasRecallEvidence({
          sourceText: params.sourceText,
          candidate: row,
          plan: params.plan,
          scope: params.scope ?? 'source',
          allowShortOnly: false,
        })
      ) {
        continue;
      }

      params.seenIds.add(row.id);
      params.accepted.push(row);
      if (params.accepted.length >= params.maxResults) break;
    }
  }

  private buildShortAcronymRawForms(term: string): string[] {
    if (!this.isShortEnglishAcronymRecallTerm(term)) return [];
    const upper = term.toUpperCase();
    return [upper, `${upper[0]}.${upper[1]}.`, `${upper[0]}.${upper[1]}`];
  }

  private buildFtsRecallQuery(terms: string[], scope: TMRecallOptions['scope']): string {
    const query = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    if ((scope ?? 'source') === 'source') {
      return `srcText : (${query})`;
    }
    return query;
  }

  private collectLikeRecallTier(params: {
    tmIds: string[];
    terms: string[];
    sourceText: string;
    plan: TMRecallQueryPlan;
    scope: TMRecallOptions['scope'];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
  }): void {
    const terms = this.uniqueTerms(params.terms)
      .filter((term) => term.length === 2 && !WEAK_SHORT_CJK_TERMS.has(term))
      .slice(0, TM_RECALL_SHORT_TERM_LIMIT);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const remaining = Math.min(
      TM_RECALL_SHORT_ROW_LIMIT,
      params.maxResults - params.accepted.length,
    );
    const placeholders = params.tmIds.map(() => '?').join(',');
    const searchesTarget = params.scope === 'source-and-target';
    const likeClauses = terms
      .map(() =>
        searchesTarget
          ? '(tm_fts.srcText LIKE ? ESCAPE \'/\' OR tm_fts.tgtText LIKE ? ESCAPE \'/\')'
          : '(tm_fts.srcText LIKE ? ESCAPE \'/\')',
      )
      .join(' OR ');
    const likeParams = terms.flatMap((term) => {
      const escaped = `%${this.escapeLikePattern(term)}%`;
      return searchesTarget ? [escaped, escaped] : [escaped];
    });

    const rows = this.db
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
        ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC
        LIMIT ${remaining * 3}
      `)
      .all(...params.tmIds, ...likeParams) as TMRecallDbRow[];

    for (const row of rows) {
      if (params.seenIds.has(row.id)) continue;
      if (
        !this.hasRecallEvidence({
          sourceText: params.sourceText,
          candidate: row,
          plan: params.plan,
          scope: params.scope ?? 'source',
          allowShortOnly: true,
        })
      ) {
        continue;
      }

      params.seenIds.add(row.id);
      params.accepted.push(row);
      if (params.accepted.length >= params.maxResults) break;
    }
  }

  private buildTMRecallQueryPlan(sourceText: string, profile?: 'english'): TMRecallQueryPlan {
    const terms = this.extractSearchTerms(sourceText);
    const cjkComponents = this.uniqueTerms(terms.flatMap((term) => this.extractCjkComponents(term)));
    const primary4 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 4));
    const primary5 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 5));
    const primary6 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 6));
    const secondary3 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 3));
    const short2 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 2));
    const englishTerms =
      profile === 'english'
        ? this.selectSpreadFragments(buildEnglishTMRecallTerms(sourceText), 32)
        : [];

    return {
      exactTerms: this.uniqueTerms(terms.filter((term) => term.length >= 3)),
      primaryCjkFragments: this.selectSpreadFragments(
        this.uniqueTerms([...primary4, ...primary5, ...primary6]),
        TM_RECALL_PRIMARY_FRAGMENT_LIMIT,
      ),
      secondaryCjkFragments: this.selectSpreadFragments(
        this.uniqueTerms(secondary3),
        TM_RECALL_SECONDARY_FRAGMENT_LIMIT,
      ),
      shortCjkTerms: this.selectSpreadFragments(
        this.uniqueTerms(short2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
        TM_RECALL_SHORT_TERM_LIMIT,
      ),
      latinTerms: this.uniqueTerms(
        terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term)),
      ),
      englishTerms,
      englishShortAcronymTerms: englishTerms.filter((term) =>
        this.isShortEnglishAcronymRecallTerm(term),
      ),
    };
  }

  private hasRecallEvidence(params: {
    sourceText: string;
    candidate: TMRecallDbRow;
    plan: TMRecallQueryPlan;
    scope: 'source' | 'source-and-target';
    allowShortOnly: boolean;
  }): boolean {
    const targets =
      params.scope === 'source-and-target'
        ? [params.candidate.ftsSrcText, params.candidate.ftsTgtText]
        : [params.candidate.ftsSrcText];

    return targets.some((target) =>
      this.hasRecallEvidenceInText(params.sourceText, target, params.plan, params.allowShortOnly),
    );
  }

  private hasRecallEvidenceInText(
    sourceText: string,
    candidateText: string,
    plan: TMRecallQueryPlan,
    allowShortOnly: boolean,
  ): boolean {
    const normalizedCandidate = candidateText.toLowerCase();

    if (plan.primaryCjkFragments.some((fragment) => normalizedCandidate.includes(fragment))) {
      return true;
    }

    const sharedSecondaryCount = plan.secondaryCjkFragments.filter((fragment) =>
      normalizedCandidate.includes(fragment),
    ).length;
    if (sharedSecondaryCount >= 2) {
      return true;
    }

    if (
      plan.latinTerms.some((term) => term.length >= 3 && normalizedCandidate.includes(term.toLowerCase()))
    ) {
      return true;
    }

    if (plan.englishTerms.some((term) => this.hasEnglishRecallTermEvidence(candidateText, term))) {
      return true;
    }

    if (!allowShortOnly) {
      return false;
    }

    const sourceComponents = this.extractCjkComponents(sourceText);
    const candidateComponents = this.extractCjkComponents(candidateText);
    const sharedShortTerms = plan.shortCjkTerms.filter((term) => normalizedCandidate.includes(term));
    if (sharedShortTerms.length >= 2) {
      return true;
    }

    return sharedShortTerms.some((term) => {
      if (WEAK_SHORT_CJK_TERMS.has(term)) return false;
      return (
        sourceComponents.some(
          (component) => component === term || (component.length <= 4 && component.includes(term)),
        ) ||
        candidateComponents.some(
          (component) => component === term || (component.length <= 4 && component.includes(term)),
        )
      );
    });
  }

  private hasEnglishRecallTermEvidence(candidateText: string, term: string): boolean {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm.length >= 3) {
      return candidateText.toLowerCase().includes(normalizedTerm);
    }
    return (
      this.isShortEnglishAcronymRecallTerm(normalizedTerm) &&
      this.hasRawShortEnglishAcronym(candidateText, normalizedTerm)
    );
  }

  private isShortEnglishAcronymRecallTerm(term: string): boolean {
    return /^[a-z]{2}$/u.test(term);
  }

  private hasRawShortEnglishAcronym(text: string, canonical: string): boolean {
    const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu) ?? [];
    return tokens.some((token) => {
      if (!/^[A-Z]{2}$/u.test(token) && !/^[A-Z]\.[A-Z]\.?$/u.test(token)) return false;
      return token.replace(/\./g, '').toLowerCase() === canonical;
    });
  }

  private diversifyConcordanceRows(
    query: string,
    rows: TMEntryRow[],
    limit: number,
  ): TMEntryRow[] {
    const accepted: TMEntryRow[] = [];
    const bucketCounts = new Map<string, number>();
    const rowBuckets = rows.map((row) => this.getConcordanceDiversityBucket(query, row));
    const canonicalBuckets = this.buildCanonicalDiversityBuckets(rowBuckets);

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rawBucket = rowBuckets[index];
      const bucket = rawBucket ? canonicalBuckets.get(rawBucket) ?? rawBucket : null;
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

  private diversifyRecallRows(
    sourceText: string,
    rows: TMRecallDbRow[],
    limit: number,
    scope: TMRecallOptions['scope'],
  ): TMRecallDbRow[] {
    const accepted: TMRecallDbRow[] = [];
    const bucketCounts = new Map<string, number>();
    const rowBuckets = rows.map((row) =>
      this.getRecallDiversityBucket(sourceText, row, scope ?? 'source'),
    );
    const canonicalBuckets = this.buildCanonicalDiversityBuckets(rowBuckets);

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rawBucket = rowBuckets[index];
      const bucket = rawBucket ? canonicalBuckets.get(rawBucket) ?? rawBucket : null;
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

  private buildCanonicalDiversityBuckets(buckets: Array<string | null>): Map<string, string> {
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

  private getRecallDiversityBucket(
    sourceText: string,
    row: TMRecallDbRow,
    scope: 'source' | 'source-and-target',
  ): string | null {
    const normalizedQuery = this.normalizeForOverlap(sourceText);
    const candidateTexts =
      scope === 'source-and-target'
        ? [row.ftsSrcText, row.ftsTgtText]
        : [row.ftsSrcText];

    return this.getBestDiversityBucket(normalizedQuery, candidateTexts);
  }

  private getConcordanceDiversityBucket(query: string, row: TMEntryRow): string | null {
    const normalizedQuery = this.normalizeForOverlap(query);
    const candidateTexts = [
      this.normalizeForOverlap(this.serializeTokensForOverlap(row.sourceTokens)),
      this.normalizeForOverlap(this.serializeTokensForOverlap(row.targetTokens)),
    ];
    return this.getBestDiversityBucket(normalizedQuery, candidateTexts);
  }

  private getBestDiversityBucket(query: string, candidateTexts: string[]): string | null {
    let best = '';

    for (const candidateText of candidateTexts) {
      const overlap = this.findLongestCommonSubstring(query, this.normalizeForOverlap(candidateText));
      if (Array.from(overlap).length > Array.from(best).length) {
        best = overlap;
      }
    }

    if (!this.isStrongCjkDiversityBucket(best)) return null;
    return best;
  }

  private serializeTokensForOverlap(tokens: Token[]): string {
    return tokens.map((token) => token.content).join('');
  }

  private normalizeForOverlap(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private findLongestCommonSubstring(a: string, b: string): string {
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

  private isStrongCjkDiversityBucket(fragment: string): boolean {
    return (
      /^[\u4e00-\u9fa5]+$/.test(fragment) &&
      Array.from(fragment).length >= TM_RECALL_DIVERSITY_MIN_CJK_BUCKET_LENGTH
    );
  }

  private extractCjkComponents(text: string): string[] {
    return text
      .split(/[^\u4e00-\u9fa5]+/g)
      .map((component) => component.trim())
      .filter((component) => component.length > 0);
  }

  private buildCjkWindows(text: string, size: number): string[] {
    const chars = Array.from(text);
    if (chars.length < size) return [];
    if (chars.length === size) return [text];

    const windows: string[] = [];
    for (let index = 0; index <= chars.length - size; index += 1) {
      windows.push(chars.slice(index, index + size).join(''));
    }
    return windows;
  }

  private uniqueTerms(terms: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const term of terms) {
      const normalized = term.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
    }
    return unique;
  }

  private dedupeTMFtsReplacementRows(rows: TMFtsReplacementRow[]): TMFtsReplacementRow[] {
    const byEntryId = new Map<string, TMFtsReplacementRow>();
    for (const row of rows) {
      byEntryId.set(row.tmEntryId, row);
    }
    return Array.from(byEntryId.values());
  }

  private selectSpreadFragments(fragments: string[], limit: number): string[] {
    const unique = this.uniqueTerms(fragments);
    if (unique.length <= limit) return unique;
    if (limit <= 1) return unique.slice(0, limit);

    const selected: string[] = [];
    const selectedIndexes = new Set<number>();
    for (let index = 0; index < limit; index += 1) {
      const sourceIndex = Math.round((index * (unique.length - 1)) / (limit - 1));
      if (selectedIndexes.has(sourceIndex)) continue;
      selectedIndexes.add(sourceIndex);
      selected.push(unique[sourceIndex]);
    }
    return selected;
  }

  private chunkTerms(terms: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < terms.length; index += size) {
      chunks.push(terms.slice(index, index + size));
    }
    return chunks;
  }

  private clampConcordanceRawLimit(rawLimit: number | undefined, minResults: number): number {
    const candidate = Number.isFinite(rawLimit)
      ? Math.floor(rawLimit as number)
      : TM_CONCORDANCE_RECALL_RAW_LIMIT;
    return Math.min(
      Math.max(candidate, minResults),
      TM_CONCORDANCE_RECALL_RAW_LIMIT_MAX,
    );
  }

  private mapTMEntryDbRow(row: TMEntryDbRow): TMEntryRow {
    return {
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson),
    };
  }

  private extractSearchTerms(query: string): string[] {
    return query
      .replace(/["()]/g, ' ')
      .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
      .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !/^\d+$/.test(term));
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/([/%_])/g, '/$1');
  }

  private logRecallDebug(message: string, payload: Record<string, unknown>): void {
    if (process.env.CAT_TM_RECALL_DEBUG !== '1') return;
    console.debug(`[TM recall] ${message}`, payload);
  }

  public listTMs(type?: TMType): TMRecord[] {
    if (type) {
      return this.db.prepare('SELECT * FROM tms WHERE type = ? ORDER BY updatedAt DESC').all(type) as TMRecord[];
    }
    return this.db.prepare('SELECT * FROM tms ORDER BY updatedAt DESC').all() as TMRecord[];
  }

  public listTMEntries(tmId: string, limit: number = 500, offset: number = 0): TMEntryRow[] {
    const rows = this.db
      .prepare(`
      SELECT *
      FROM tm_entries
      WHERE tmId = ?
      ORDER BY updatedAt DESC, id ASC
      LIMIT ? OFFSET ?
    `)
      .all(tmId, limit, offset) as TMEntryDbRow[];

    return rows.map((row) => this.mapTMEntryDbRow(row));
  }

  public createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string {
    const id = randomUUID();
    this.db
      .prepare(`
      INSERT INTO tms (id, name, srcLang, tgtLang, type)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run(id, name, srcLang, tgtLang, type);
    return id;
  }

  public renameTM(id: string, name: string): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('TM name cannot be empty.');
    }
    const result = this.db.prepare('UPDATE tms SET name = ? WHERE id = ?').run(trimmedName, id);
    if (result.changes === 0) {
      throw new Error('TM not found.');
    }
  }

  public deleteTM(id: string) {
    const deleteRows = () => {
      this.db.prepare('DELETE FROM tm_fts WHERE tmId = ?').run(id);
      this.db.prepare('DELETE FROM tms WHERE id = ?').run(id);
    };

    if (this.db.inTransaction) {
      deleteRows();
      return;
    }

    this.db.transaction(deleteRows)();
  }

  public clearTMEntries(tmId: string): number {
    const clearRows = () => {
      this.db
        .prepare(`
          DELETE FROM tm_fts
          WHERE rowid IN (
            SELECT ftsRowid
            FROM tm_entries
            WHERE tmId = ? AND ftsRowid IS NOT NULL
          )
        `)
        .run(tmId);
      return this.db.prepare('DELETE FROM tm_entries WHERE tmId = ?').run(tmId).changes;
    };

    if (this.db.inTransaction) {
      return clearRows();
    }

    return this.db.transaction(clearRows)();
  }

  public mountTMToProject(projectId: number, tmId: string, priority: number = 10, permission: string = 'read') {
    this.db
      .prepare(`
      INSERT INTO project_tms (projectId, tmId, priority, permission, isEnabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(projectId, tmId) DO UPDATE SET
        priority = excluded.priority,
        permission = excluded.permission,
        isEnabled = 1
    `)
      .run(projectId, tmId, priority, permission);
  }

  public unmountTMFromProject(projectId: number, tmId: string) {
    this.db.prepare('DELETE FROM project_tms WHERE projectId = ? AND tmId = ?').run(projectId, tmId);
  }

  public getTMStats(tmId: string) {
    const row = this.db
      .prepare('SELECT COUNT(*) as count, MAX(updatedAt) as maxUpdatedAt FROM tm_entries WHERE tmId = ?')
      .get(tmId) as {
      count: number;
      maxUpdatedAt: string | null;
    };
    return {
      entryCount: row.count,
      maxEntryUpdatedAt: row.maxUpdatedAt,
    };
  }

  public getTM(tmId: string): TMRecord | undefined {
    return this.db.prepare('SELECT * FROM tms WHERE id = ?').get(tmId) as TMRecord | undefined;
  }

  // --- TM external-file sync (incremental diff over tm_sync_staging) ---
  //
  // Statements are prepared lazily: tm_sync_staging is an additive table
  // created by schema maintenance, which readonly connections skip.

  private stmtUpdateTMSyncTarget?: Database.Statement;

  public clearTMSyncStagingForTM(tmId: string, exceptRunId?: string): void {
    if (exceptRunId) {
      this.db
        .prepare('DELETE FROM tm_sync_staging WHERE tmId = ? AND syncRunId != ?')
        .run(tmId, exceptRunId);
      return;
    }
    this.db.prepare('DELETE FROM tm_sync_staging WHERE tmId = ?').run(tmId);
  }

  public clearTMSyncStagingRun(runId: string): void {
    this.db.prepare('DELETE FROM tm_sync_staging WHERE syncRunId = ?').run(runId);
  }

  // Must be called inside a transaction owned by the caller. INSERT OR REPLACE
  // on the (syncRunId, srcHash) primary key makes later file rows win when the
  // file contains duplicate sources. Rows arrive in file order and multi-row
  // VALUES preserves it, so REPLACE semantics are unchanged by batching.
  public stageTMSyncRows(runId: string, tmId: string, rows: TMSyncStagedRow[]): void {
    for (let index = 0; index < rows.length; index += TM_SYNC_INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + TM_SYNC_INSERT_BATCH_SIZE);
      const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      this.db
        .prepare(`
          INSERT OR REPLACE INTO tm_sync_staging (
            tmId, syncRunId, srcHash, matchKey, tagsSignature,
            sourceTokensJson, targetTokensJson, srcText, tgtText
          ) VALUES ${values}
        `)
        .run(
          ...batch.flatMap((row) => [
            tmId,
            runId,
            row.srcHash,
            row.matchKey,
            row.tagsSignature,
            row.sourceTokensJson,
            row.targetTokensJson,
            row.srcText,
            row.tgtText,
          ]),
        );
    }
  }

  public countTMSyncStagedRows(runId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM tm_sync_staging WHERE syncRunId = ?')
      .get(runId) as { count: number };
    return row.count;
  }

  public getTMSyncDiffSummary(
    runId: string,
    tmId: string,
    lastSyncedAt?: string,
  ): TMSyncDiffSummary {
    const added = (
      this.db
        .prepare(`
          SELECT COUNT(*) as count FROM tm_sync_staging s
          LEFT JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
          WHERE s.syncRunId = ? AND e.id IS NULL
        `)
        .get(tmId, runId) as { count: number }
    ).count;

    const changed = (
      this.db
        .prepare(`
          SELECT COUNT(*) as count FROM tm_sync_staging s
          JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
          WHERE s.syncRunId = ?
            AND (e.targetTokensJson != s.targetTokensJson
              OR e.sourceTokensJson != s.sourceTokensJson)
        `)
        .get(tmId, runId) as { count: number }
    ).count;

    const deleted = (
      this.db
        .prepare(`
          SELECT COUNT(*) as count FROM tm_entries e
          WHERE e.tmId = ?
            AND NOT EXISTS (
              SELECT 1 FROM tm_sync_staging s
              WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
            )
        `)
        .get(tmId, runId) as { count: number }
    ).count;

    const overwrittenLocalEdits = lastSyncedAt
      ? (
          this.db
            .prepare(`
              SELECT COUNT(*) as count FROM tm_sync_staging s
              JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
              WHERE s.syncRunId = ?
                AND (e.targetTokensJson != s.targetTokensJson
                  OR e.sourceTokensJson != s.sourceTokensJson)
                AND e.updatedAt > ?
            `)
            .get(tmId, runId, lastSyncedAt) as { count: number }
        ).count
      : 0;

    // Entries missing from the file whose local edits postdate the last full
    // sync: a prune-all run would silently destroy those edits, so they get
    // their own warning count.
    const deletedLocalEdits = lastSyncedAt
      ? (
          this.db
            .prepare(`
              SELECT COUNT(*) as count FROM tm_entries e
              WHERE e.tmId = ?
                AND NOT EXISTS (
                  SELECT 1 FROM tm_sync_staging s
                  WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
                )
                AND e.updatedAt > ?
            `)
            .get(tmId, runId, lastSyncedAt) as { count: number }
        ).count
      : 0;

    return { added, changed, deleted, overwrittenLocalEdits, deletedLocalEdits };
  }

  // Keyset pagination (srcHash > afterSrcHash) keeps pages stable while the
  // caller applies earlier pages between calls: applied rows drop out of the
  // diff, but only at keys the cursor has already passed.
  public listTMSyncNewRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncStagedRow[] {
    return this.db
      .prepare(`
        SELECT s.srcHash, s.matchKey, s.tagsSignature,
               s.sourceTokensJson, s.targetTokensJson, s.srcText, s.tgtText
        FROM tm_sync_staging s
        LEFT JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
        WHERE s.syncRunId = ? AND s.srcHash > ? AND e.id IS NULL
        ORDER BY s.srcHash ASC
        LIMIT ?
      `)
      .all(tmId, runId, afterSrcHash, limit) as TMSyncStagedRow[];
  }

  public listTMSyncChangedRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncChangedRow[] {
    return this.db
      .prepare(`
        SELECT s.srcHash, s.matchKey, s.tagsSignature,
               s.sourceTokensJson, s.targetTokensJson, s.srcText, s.tgtText,
               e.id AS entryId
        FROM tm_sync_staging s
        JOIN tm_entries e ON e.tmId = ? AND e.srcHash = s.srcHash
        WHERE s.syncRunId = ? AND s.srcHash > ?
          AND (e.targetTokensJson != s.targetTokensJson
            OR e.sourceTokensJson != s.sourceTokensJson)
        ORDER BY s.srcHash ASC
        LIMIT ?
      `)
      .all(tmId, runId, afterSrcHash, limit) as TMSyncChangedRow[];
  }

  public listTMSyncDeletedEntries(
    runId: string,
    tmId: string,
    afterId: string,
    limit: number,
  ): Array<{ id: string }> {
    return this.db
      .prepare(`
        SELECT e.id FROM tm_entries e
        WHERE e.tmId = ? AND e.id > ?
          AND NOT EXISTS (
            SELECT 1 FROM tm_sync_staging s
            WHERE s.syncRunId = ? AND s.srcHash = e.srcHash
          )
        ORDER BY e.id ASC
        LIMIT ?
      `)
      .all(tmId, afterId, runId, limit) as Array<{ id: string }>;
  }

  // Must be called inside a transaction owned by the caller. Entry and FTS
  // rows are written as a pair so a rollback never leaves a dangling FTS row.
  //
  // Batched: one multi-row INSERT per table instead of three statements per
  // row (entry INSERT + FTS INSERT + ftsRowid UPDATE), which dominated large
  // sync applies. FTS rowids are assigned explicitly from MAX(rowid) — safe
  // because the surrounding transaction holds the write lock — so the
  // tm_entries.ftsRowid mapping can be written as one UPDATE ... FROM.
  public applyTMSyncInserts(
    tmId: string,
    rows: Array<TMSyncStagedRow & { id: string }>,
  ): number {
    let inserted = 0;
    for (let index = 0; index < rows.length; index += TM_SYNC_INSERT_BATCH_SIZE) {
      inserted += this.applyTMSyncInsertBatch(
        tmId,
        rows.slice(index, index + TM_SYNC_INSERT_BATCH_SIZE),
      );
    }
    return inserted;
  }

  private applyTMSyncInsertBatch(
    tmId: string,
    rows: Array<TMSyncStagedRow & { id: string }>,
  ): number {
    if (rows.length === 0) return 0;

    const entryValues = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, NULL, 0)').join(', ');
    const insertedRows = this.db
      .prepare(`
        INSERT INTO tm_entries (
          id, tmId, srcHash, matchKey, tagsSignature,
          sourceTokensJson, targetTokensJson, originSegmentId, usageCount
        ) VALUES ${entryValues}
        ON CONFLICT(tmId, srcHash) DO NOTHING
        RETURNING id
      `)
      .all(
        ...rows.flatMap((row) => [
          row.id,
          tmId,
          row.srcHash,
          row.matchKey,
          row.tagsSignature,
          row.sourceTokensJson,
          row.targetTokensJson,
        ]),
      ) as Array<{ id: string }>;
    if (insertedRows.length === 0) return 0;

    // RETURNING row order is unspecified; filter the input by inserted id.
    const insertedIds = new Set(insertedRows.map((row) => row.id));
    const inserted = rows.filter((row) => insertedIds.has(row.id));

    const baseRowid = (
      this.db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM tm_fts').get() as { m: number }
    ).m;
    const ftsValues = inserted.map(() => '(?, ?, ?, ?, ?)').join(', ');
    this.db
      .prepare(`INSERT INTO tm_fts (rowid, tmId, srcText, tgtText, tmEntryId) VALUES ${ftsValues}`)
      .run(
        ...inserted.flatMap((row, offset) => [
          baseRowid + 1 + offset,
          tmId,
          row.srcText,
          row.tgtText,
          row.id,
        ]),
      );

    const mappingValues = inserted.map(() => '(?, ?)').join(', ');
    this.db
      .prepare(`
        WITH v(rid, eid) AS (VALUES ${mappingValues})
        UPDATE tm_entries SET ftsRowid = v.rid FROM v WHERE tm_entries.id = v.eid
      `)
      .run(...inserted.flatMap((row, offset) => [baseRowid + 1 + offset, row.id]));

    return inserted.length;
  }

  // Must be called inside a transaction owned by the caller. Sync updates
  // refresh both sides' display tokens (srcHash-identical sources can still
  // differ in case/whitespace) but never touch usageCount/createdAt/
  // originSegmentId: those are usage metadata the file must not reset.
  public applyTMSyncUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number {
    this.stmtUpdateTMSyncTarget ??= this.db.prepare(`
      UPDATE tm_entries
      SET sourceTokensJson = ?, targetTokensJson = ?,
          updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `);

    let updated = 0;
    for (const row of rows) {
      const result = this.stmtUpdateTMSyncTarget.run(
        row.sourceTokensJson,
        row.targetTokensJson,
        row.entryId,
      );
      if (result.changes === 0) continue;

      this.deleteTMFtsForEntry(row.entryId);
      this.insertTMFtsForEntry(tmId, row.srcText, row.tgtText, row.entryId);
      updated += 1;
    }
    return updated;
  }

  // Must be called inside a transaction owned by the caller. The FTS rows go
  // first: deleteTMFtsForEntry reads ftsRowid from the entry row.
  public deleteTMEntriesWithFts(entryIds: string[]): number {
    let deleted = 0;
    for (let index = 0; index < entryIds.length; index += TM_FTS_REPLACE_DELETE_BATCH_SIZE) {
      const batch = entryIds.slice(index, index + TM_FTS_REPLACE_DELETE_BATCH_SIZE);
      for (const entryId of batch) {
        this.deleteTMFtsForEntry(entryId);
      }
      const placeholders = batch.map(() => '?').join(',');
      const result = this.db
        .prepare(`DELETE FROM tm_entries WHERE id IN (${placeholders})`)
        .run(...batch);
      deleted += result.changes;
    }
    return deleted;
  }

  // Incremental FTS maintenance with bounded cost per call. A full
  // 'optimize' rewrites the whole tm_fts index, so its latency grows with
  // TOTAL entries across all TMs (~9s at 460k entries) even when the sync
  // touched far fewer rows.
  //
  // FTS5 'merge' semantics (per docs): a POSITIVE step continues a merge
  // already underway (or starts one only among >= usermerge same-level
  // segments); a NEGATIVE step starts a merge of ALL segments but RESTARTS
  // from scratch on every call. So: probe with one positive step first —
  // if it did real work, a merge was underway (or same-level segments were
  // consolidated) and we just continue stepping. Only when the probe is a
  // no-op (nothing underway, nothing same-level) kick off ONE negative
  // merge-all and step that. Work not finished within the round budget is
  // resumed — not repeated — by the next call's positive probe.
  public optimizeTMFts(): void {
    this.db.prepare(`INSERT INTO tm_fts(tm_fts, rank) VALUES('usermerge', 2)`).run();
    const stmtMerge = this.db.prepare(`INSERT INTO tm_fts(tm_fts, rank) VALUES('merge', ?)`);
    const stmtChanges = this.db.prepare('SELECT total_changes() AS c');
    const readChanges = () => (stmtChanges.get() as { c: number }).c;
    // Per the FTS5 docs, a merge step that modifies fewer than 2 rows did
    // no real work.
    const step = (pages: number): boolean => {
      const before = readChanges();
      stmtMerge.run(pages);
      return readChanges() - before >= 2;
    };

    if (!step(TM_FTS_MERGE_STEP_PAGES)) {
      if (!step(-TM_FTS_MERGE_STEP_PAGES)) return;
    }
    for (let round = 0; round < TM_FTS_MERGE_MAX_ROUNDS; round++) {
      if (!step(TM_FTS_MERGE_STEP_PAGES)) break;
    }
  }
}
