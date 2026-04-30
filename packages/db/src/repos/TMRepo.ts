import Database from 'better-sqlite3';
import type { TMEntry, Token } from '@cat/core/models';
import { randomUUID } from 'crypto';
import type {
  MountedTMRecord,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
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
const TM_RECALL_DIVERSITY_MAX_PER_BUCKET = 2;
const TM_RECALL_DIVERSITY_MIN_CJK_BUCKET_LENGTH = 4;
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

    this.stmtDeleteTMFtsByEntryId.run(entry.id);
    this.stmtInsertTMFts.run(entry.tmId, srcText, tgtText, entry.id);
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
    this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.stmtDeleteTMFtsByEntryId.run(tmEntryId);
    this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
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
    const maxResults = Math.min(
      Math.max(options.limit ?? TM_RECALL_DEFAULT_LIMIT, 0),
      TM_RECALL_MAX_LIMIT,
    );
    if (maxResults === 0) return [];

    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) return [];

    const plan = this.buildTMRecallQueryPlan(sourceText);
    const accepted: TMRecallDbRow[] = [];
    const seenIds = new Set<string>();
    const scope = options.scope ?? 'source';
    const collectionLimit = Math.min(
      maxResults * TM_RECALL_DIVERSITY_POOL_MULTIPLIER,
      TM_RECALL_MAX_LIMIT * TM_RECALL_DIVERSITY_POOL_MULTIPLIER,
    );

    this.collectFtsRecallTier({
      tmIds: resolvedTmIds,
      terms: [...plan.exactTerms, ...plan.latinTerms],
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

  private buildTMRecallQueryPlan(sourceText: string): TMRecallQueryPlan {
    const terms = this.extractSearchTerms(sourceText);
    const cjkComponents = this.uniqueTerms(terms.flatMap((term) => this.extractCjkComponents(term)));
    const primary4 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 4));
    const primary5 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 5));
    const primary6 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 6));
    const secondary3 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 3));
    const short2 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 2));

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
    if (chars.length < size) return chars.length === size ? [text] : [];

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

  public listTMs(type?: TMType): TMRecord[] {
    if (type) {
      return this.db.prepare('SELECT * FROM tms WHERE type = ? ORDER BY updatedAt DESC').all(type) as TMRecord[];
    }
    return this.db.prepare('SELECT * FROM tms ORDER BY updatedAt DESC').all() as TMRecord[];
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

  public deleteTM(id: string) {
    this.db.prepare('DELETE FROM tms WHERE id = ?').run(id);
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
    const count = this.db.prepare('SELECT COUNT(*) as count FROM tm_entries WHERE tmId = ?').get(tmId) as {
      count: number;
    };
    return { entryCount: count.count };
  }

  public getTM(tmId: string): TMRecord | undefined {
    return this.db.prepare('SELECT * FROM tms WHERE id = ?').get(tmId) as TMRecord | undefined;
  }
}
