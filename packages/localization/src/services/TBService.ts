import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  buildEnglishTermRecognizer,
  findTermPositionsInTextForLocale,
  resolveSourceRecallProfile,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  suppressNestedTermMatches,
  type EnglishTermRecognizer,
  type EnglishTermRecognizerMatch,
  type EnglishTermVariantKind,
} from '@cat/core/text';
import type { ProjectRepository, TBRepository } from '../ports';

type ProjectTBEntry = TBEntry & {
  tbName: string;
  priority: number;
};

type EnglishRecognizerEntry = ProjectTBEntry & {
  priority: number;
  usageCount: number;
};

type EnglishCandidateTier = 'recognizerCanonical' | 'recognizerVariant' | 'dbFallback';

interface EnglishTBRecognizerCacheEntry {
  key: string;
  recognizer: EnglishTermRecognizer<EnglishRecognizerEntry>;
  isComplete: boolean;
}

interface EnglishTBCandidate {
  entry: EnglishRecognizerEntry;
  positions: Array<{ start: number; end: number }>;
  tier: EnglishCandidateTier;
  variantKind?: EnglishTermVariantKind;
}

interface EnglishTBPositionCandidate {
  match: TBMatch;
  position: { start: number; end: number };
}

export class TBService {
  private static readonly TB_CANDIDATE_LIMIT = 200;
  private static readonly ENGLISH_TB_RECOGNIZER_PROFILE_VERSION = 1;
  // Bounded to cap worst-case worker memory: each cached project recognizer
  // retains ~6.9KB/entry, so at the 20k entry ceiling one project is ~140MB.
  // Two workers (lookup + prefetch) each hold their own cache, so keep this
  // small — 2 projects/worker keeps the worst case near ~560MB total.
  private static readonly ENGLISH_TB_RECOGNIZER_CACHE_MAX_PROJECTS = 2;

  private projectRepo: ProjectRepository;
  private db: TBRepository;
  private readonly englishRecognizerCache = new Map<number, EnglishTBRecognizerCacheEntry>();

  constructor(projectRepo: ProjectRepository, db: TBRepository) {
    this.projectRepo = projectRepo;
    this.db = db;
  }

  public async findMatches(projectId: number, segment: Segment): Promise<TBMatch[]> {
    const project = this.projectRepo.getProject(projectId);
    if (!project) return [];

    const profile = resolveSourceRecallProfile(project.srcLang);
    if (profile === 'en') {
      return this.findEnglishProfileMatches(projectId, segment, project.srcLang);
    }

    return this.findLegacyProfileMatches(projectId, segment, project.srcLang);
  }

  /**
   * Drop cached recognizer indexes. Needed when TB data changed through another
   * DB connection (e.g. the main process synced a TB while this service runs in
   * a lookup worker): the in-process TB data version never bumps in that case,
   * so the version-keyed cache would keep serving stale terms.
   */
  public invalidateCachedIndexes(): void {
    this.englishRecognizerCache.clear();
  }

  private findLegacyProfileMatches(
    projectId: number,
    segment: Segment,
    srcLang: string,
  ): TBMatch[] {
    const sourceText = serializeTokensToSearchText(segment.sourceTokens);
    if (!sourceText.trim()) return [];

    const searchEntries = this.db.searchProjectTermEntries(projectId, sourceText, {
      srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as ProjectTBEntry[];
    const entries =
      searchEntries.length > 0
        ? searchEntries
        : (this.db.listProjectTermEntries(projectId) as ProjectTBEntry[]);
    if (entries.length === 0) return [];

    const matches: TBMatch[] = [];
    const seenSrcNorm = new Set<string>();

    for (const entry of entries) {
      if (seenSrcNorm.has(entry.srcNorm)) continue;
      const positions = findTermPositionsInTextForLocale(sourceText, entry.srcTerm, {
        locale: srcLang,
      });
      if (positions.length === 0) continue;

      matches.push({
        ...entry,
        positions,
      });
      seenSrcNorm.add(entry.srcNorm);
    }

    return suppressNestedTermMatches(
      matches.sort((a, b) => {
        if (b.srcTerm.length !== a.srcTerm.length) return b.srcTerm.length - a.srcTerm.length;
        return a.priority - b.priority;
      }),
    );
  }

  private findEnglishProfileMatches(
    projectId: number,
    segment: Segment,
    srcLang: string,
  ): TBMatch[] {
    const searchText = serializeTokensToSearchTextWithBoundaries(segment.sourceTokens);
    if (!searchText.text.trim()) return [];

    const recognizerIndex = this.getEnglishRecognizer(projectId);
    const recognizerCandidates = this.toEnglishCandidates(
      recognizerIndex.recognizer.scan(searchText.text, {
        hardBoundaryOffsets: searchText.hardBoundaryOffsets,
      }),
    );

    const dbRecognizedCandidates = recognizerIndex.isComplete
      ? []
      : this.findEnglishDbFallbackCandidates(projectId, searchText.text, srcLang, {
          hardBoundaryOffsets: searchText.hardBoundaryOffsets,
        });

    return this.mergeEnglishCandidates([...recognizerCandidates, ...dbRecognizedCandidates]);
  }

  private getEnglishRecognizer(projectId: number): EnglishTBRecognizerCacheEntry {
    const key = this.buildEnglishRecognizerCacheKey();
    const cached = this.englishRecognizerCache.get(projectId);
    if (cached?.key === key) {
      this.refreshEnglishRecognizerCacheRecency(projectId, cached);
      return cached;
    }

    const entries = this.db.listProjectTermEntries(projectId) as EnglishRecognizerEntry[];
    const recognizer = buildEnglishTermRecognizer(entries);
    const totalMountedEntryCount = this.db
      .getProjectMountedTermBases(projectId)
      .reduce((total, tb) => total + this.db.getTermBaseStats(tb.id).entryCount, 0);
    const cacheEntry = {
      key,
      recognizer,
      isComplete: entries.length >= totalMountedEntryCount,
    };
    if (!cacheEntry.isComplete) {
      console.warn(
        `[TBService] EN recognizer index for project ${projectId} holds ${entries.length} of ` +
          `${totalMountedEntryCount} mounted TB entries; per-segment DB fallback recall is enabled`,
      );
    }
    // Map.set on an existing key keeps its old insertion position, so a
    // rebuild (data-version bump) must delete first to count as a fresh use;
    // otherwise the just-rebuilt recognizer can be evicted as the LRU entry.
    this.englishRecognizerCache.delete(projectId);
    this.englishRecognizerCache.set(projectId, cacheEntry);
    this.evictStaleEnglishRecognizerCacheEntries();
    return cacheEntry;
  }

  private buildEnglishRecognizerCacheKey(): string {
    return `profile=${TBService.ENGLISH_TB_RECOGNIZER_PROFILE_VERSION}|v=${this.db.getTBDataVersion()}`;
  }

  private refreshEnglishRecognizerCacheRecency(
    projectId: number,
    cacheEntry: EnglishTBRecognizerCacheEntry,
  ): void {
    this.englishRecognizerCache.delete(projectId);
    this.englishRecognizerCache.set(projectId, cacheEntry);
  }

  private evictStaleEnglishRecognizerCacheEntries(): void {
    while (this.englishRecognizerCache.size > TBService.ENGLISH_TB_RECOGNIZER_CACHE_MAX_PROJECTS) {
      const oldestProjectId = this.englishRecognizerCache.keys().next().value;
      if (oldestProjectId === undefined) return;
      this.englishRecognizerCache.delete(oldestProjectId);
    }
  }

  private findEnglishDbFallbackCandidates(
    projectId: number,
    sourceText: string,
    srcLang: string,
    scanOptions: { hardBoundaryOffsets: number[] },
  ): EnglishTBCandidate[] {
    const dbCandidates = this.db.searchProjectTermEntries(projectId, sourceText, {
      srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as EnglishRecognizerEntry[];
    const dbRecognizer = buildEnglishTermRecognizer(dbCandidates);
    return this.toEnglishCandidates(
      dbRecognizer.scan(sourceText, scanOptions),
      'dbFallback',
    );
  }

  private toEnglishCandidates(
    matches: Array<EnglishTermRecognizerMatch<EnglishRecognizerEntry>>,
    forcedTier?: EnglishCandidateTier,
  ): EnglishTBCandidate[] {
    const byEntry = new Map<string, EnglishTBCandidate>();

    for (const match of matches) {
      const tier =
        forcedTier ??
        (match.variantKind === 'canonical' ? 'recognizerCanonical' : 'recognizerVariant');
      const existing = byEntry.get(match.entry.id);
      if (existing) {
        existing.positions.push({ start: match.start, end: match.end });
        existing.tier = this.pickBetterEnglishTier(existing.tier, tier);
        continue;
      }

      byEntry.set(match.entry.id, {
        entry: match.entry,
        positions: [{ start: match.start, end: match.end }],
        tier,
        variantKind: match.variantKind,
      });
    }

    return Array.from(byEntry.values());
  }

  private mergeEnglishCandidates(candidates: EnglishTBCandidate[]): TBMatch[] {
    const bySrcNorm = new Map<string, EnglishTBCandidate>();

    for (const candidate of candidates.sort(this.compareEnglishCandidates)) {
      const existing = bySrcNorm.get(candidate.entry.srcNorm);
      if (!existing) {
        bySrcNorm.set(candidate.entry.srcNorm, candidate);
        continue;
      }

      existing.positions.push(...candidate.positions);
    }

    const matches = Array.from(bySrcNorm.values())
      .map((candidate) => ({
        ...candidate.entry,
        positions: this.uniquePositions(candidate.positions),
      }));

    return this.suppressNestedEnglishPositions(matches, bySrcNorm).sort((a, b) => {
      const candidateA = bySrcNorm.get(a.srcNorm);
      const candidateB = bySrcNorm.get(b.srcNorm);
      if (candidateA && candidateB) {
        return this.compareEnglishCandidates(candidateA, candidateB);
      }
      return 0;
    });
  }

  private compareEnglishCandidates = (a: EnglishTBCandidate, b: EnglishTBCandidate): number => {
    const tierDiff = this.englishTierRank(a.tier) - this.englishTierRank(b.tier);
    if (tierDiff !== 0) return tierDiff;
    if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
    if (b.entry.srcTerm.length !== a.entry.srcTerm.length) {
      return b.entry.srcTerm.length - a.entry.srcTerm.length;
    }
    if (b.entry.usageCount !== a.entry.usageCount) return b.entry.usageCount - a.entry.usageCount;
    return a.entry.id.localeCompare(b.entry.id);
  };

  private suppressNestedEnglishPositions(
    matches: TBMatch[],
    candidateBySrcNorm: Map<string, EnglishTBCandidate>,
  ): TBMatch[] {
    const occupiedRanges: Array<{ start: number; end: number }> = [];
    const selectedBySrcNorm = new Map<string, TBMatch>();
    const positionCandidates = this.flattenEnglishPositionCandidates(matches).sort((a, b) =>
      this.compareEnglishPositionCandidates(a, b, candidateBySrcNorm),
    );

    for (const candidate of positionCandidates) {
      if (
        occupiedRanges.some((range) =>
          this.isStrictlyContainedPosition(candidate.position, range),
        )
      ) {
        continue;
      }

      occupiedRanges.push(candidate.position);
      const existing = selectedBySrcNorm.get(candidate.match.srcNorm);
      if (existing) {
        existing.positions.push(candidate.position);
        continue;
      }

      selectedBySrcNorm.set(candidate.match.srcNorm, {
        ...candidate.match,
        positions: [candidate.position],
      });
    }

    return Array.from(selectedBySrcNorm.values()).map((match) => ({
      ...match,
      positions: this.sortPositions(match.positions),
    }));
  }

  private flattenEnglishPositionCandidates(matches: TBMatch[]): EnglishTBPositionCandidate[] {
    return matches.flatMap((match) =>
      match.positions.map((position) => ({
        match,
        position,
      })),
    );
  }

  private compareEnglishPositionCandidates(
    a: EnglishTBPositionCandidate,
    b: EnglishTBPositionCandidate,
    candidateBySrcNorm: Map<string, EnglishTBCandidate>,
  ): number {
    const lengthDiff = this.positionLength(b.position) - this.positionLength(a.position);
    if (lengthDiff !== 0) return lengthDiff;

    const startDiff = a.position.start - b.position.start;
    if (startDiff !== 0) return startDiff;

    const endDiff = b.position.end - a.position.end;
    if (endDiff !== 0) return endDiff;

    const candidateA = candidateBySrcNorm.get(a.match.srcNorm);
    const candidateB = candidateBySrcNorm.get(b.match.srcNorm);
    if (candidateA && candidateB) {
      const candidateDiff = this.compareEnglishCandidates(candidateA, candidateB);
      if (candidateDiff !== 0) return candidateDiff;
    }

    return a.match.id.localeCompare(b.match.id);
  }

  private isStrictlyContainedPosition(
    inner: { start: number; end: number },
    outer: { start: number; end: number },
  ): boolean {
    return (
      outer.start <= inner.start &&
      outer.end >= inner.end &&
      this.positionLength(outer) > this.positionLength(inner)
    );
  }

  private positionLength(position: { start: number; end: number }): number {
    return position.end - position.start;
  }

  private sortPositions(positions: Array<{ start: number; end: number }>) {
    return positions.slice().sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - a.end;
    });
  }

  private pickBetterEnglishTier(
    current: EnglishCandidateTier,
    next: EnglishCandidateTier,
  ): EnglishCandidateTier {
    return this.englishTierRank(next) < this.englishTierRank(current) ? next : current;
  }

  private englishTierRank(tier: EnglishCandidateTier): number {
    switch (tier) {
      case 'recognizerCanonical':
        return 0;
      case 'recognizerVariant':
        return 1;
      case 'dbFallback':
        return 2;
    }
  }

  private uniquePositions(positions: Array<{ start: number; end: number }>) {
    const seen = new Set<string>();
    return positions.filter((position) => {
      const key = `${position.start}:${position.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
