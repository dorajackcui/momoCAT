import type Database from 'better-sqlite3';
import { buildEnglishTMRecallTerms } from '@cat/core/text';
import type { MountedTMRecord, TMEntryRow, TMRecallOptions } from '../../types';
import { mapTMEntryDbRow, type TMRecallDbRow } from './tmEntryRows';
import {
  buildCjkWindows,
  buildFtsRecallQuery,
  extractCjkComponents,
  extractSearchTerms,
  escapeLikePattern,
  selectSpreadFragments,
  uniqueTerms,
  ONLY_CJK_RE,
  WEAK_SHORT_CJK_TERMS,
} from './tmRecallQuery';
import { diversifyRecallRows } from './tmRecallDiversity';

interface TMRecallQueryPlan {
  exactTerms: string[];
  primaryCjkFragments: string[];
  secondaryCjkFragments: string[];
  shortCjkTerms: string[];
  latinTerms: string[];
  englishTerms: string[];
  englishShortAcronymTerms: string[];
}

const TM_RECALL_DEFAULT_LIMIT = 50;
export const TM_RECALL_MAX_LIMIT = 50;
const TM_RECALL_DIVERSITY_POOL_MULTIPLIER = 3;
const TM_RECALL_PRIMARY_FRAGMENT_LIMIT = 16;
const TM_RECALL_SECONDARY_FRAGMENT_LIMIT = 12;
const TM_RECALL_SHORT_TERM_LIMIT = 4;
const TM_RECALL_SHORT_ROW_LIMIT = 10;
const TM_RECALL_SECONDARY_TRIGGER = 8;
const TM_RECALL_SHORT_TRIGGER = 6;

/** Bounded fuzzy candidate collection; TMRepo resolves the public search surface. */
export class TMFuzzyRecall {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectMountedTMs: (projectId: number) => MountedTMRecord[],
  ) {}

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

    return diversifyRecallRows(sourceText, accepted, maxResults, scope).map((row) =>
      mapTMEntryDbRow(row),
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
    const terms = uniqueTerms(params.terms).filter((term) => term.length >= 3);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const ftsQuery = buildFtsRecallQuery(terms, params.scope ?? 'source');
    const rawLimit = Math.max(params.maxResults * 3, 20);

    const rows = this.db
      .prepare(
        `
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
        ORDER BY rank
        LIMIT ${rawLimit}
      `,
      )
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
    const terms = uniqueTerms(params.plan.englishShortAcronymTerms);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const forms = uniqueTerms(terms.flatMap((term) => this.buildShortAcronymRawForms(term)));
    if (forms.length === 0) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const formPlaceholders = forms.map(() => '?').join(',');
    const remaining = Math.min(params.maxResults - params.accepted.length, forms.length * 4);
    if (remaining <= 0) return;

    const rows = this.db
      .prepare(
        `
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts.srcText IN (${formPlaceholders})
        ORDER BY length(tm_fts.srcText) ASC, tm_entries.usageCount DESC, tm_entries.updatedAt DESC, tm_entries.id ASC
        LIMIT ?
      `,
      )
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
    const terms = uniqueTerms(params.terms)
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
          ? "(tm_fts.srcText LIKE ? ESCAPE '/' OR tm_fts.tgtText LIKE ? ESCAPE '/')"
          : "(tm_fts.srcText LIKE ? ESCAPE '/')",
      )
      .join(' OR ');
    const likeParams = terms.flatMap((term) => {
      const escaped = `%${escapeLikePattern(term)}%`;
      return searchesTarget ? [escaped, escaped] : [escaped];
    });

    const rows = this.db
      .prepare(
        `
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
        ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC
        LIMIT ${remaining * 3}
      `,
      )
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
    const terms = extractSearchTerms(sourceText);
    const cjkComponents = uniqueTerms(terms.flatMap((term) => extractCjkComponents(term)));
    const primary4 = cjkComponents.flatMap((component) => buildCjkWindows(component, 4));
    const primary5 = cjkComponents.flatMap((component) => buildCjkWindows(component, 5));
    const primary6 = cjkComponents.flatMap((component) => buildCjkWindows(component, 6));
    const secondary3 = cjkComponents.flatMap((component) => buildCjkWindows(component, 3));
    const short2 = cjkComponents.flatMap((component) => buildCjkWindows(component, 2));
    const englishTerms =
      profile === 'english' ? selectSpreadFragments(buildEnglishTMRecallTerms(sourceText), 32) : [];

    return {
      exactTerms: uniqueTerms(terms.filter((term) => term.length >= 3)),
      primaryCjkFragments: selectSpreadFragments(
        uniqueTerms([...primary4, ...primary5, ...primary6]),
        TM_RECALL_PRIMARY_FRAGMENT_LIMIT,
      ),
      secondaryCjkFragments: selectSpreadFragments(
        uniqueTerms(secondary3),
        TM_RECALL_SECONDARY_FRAGMENT_LIMIT,
      ),
      shortCjkTerms: selectSpreadFragments(
        uniqueTerms(short2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
        TM_RECALL_SHORT_TERM_LIMIT,
      ),
      latinTerms: uniqueTerms(terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term))),
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
      plan.latinTerms.some(
        (term) => term.length >= 3 && normalizedCandidate.includes(term.toLowerCase()),
      )
    ) {
      return true;
    }

    if (plan.englishTerms.some((term) => this.hasEnglishRecallTermEvidence(candidateText, term))) {
      return true;
    }

    if (!allowShortOnly) {
      return false;
    }

    const sourceComponents = extractCjkComponents(sourceText);
    const candidateComponents = extractCjkComponents(candidateText);
    const sharedShortTerms = plan.shortCjkTerms.filter((term) =>
      normalizedCandidate.includes(term),
    );
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
}
