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
import type { MountedTBRecord, ProjectRepository, TBRepository } from '../ports';

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
}

interface EnglishTBCandidate {
  entry: EnglishRecognizerEntry;
  positions: Array<{ start: number; end: number }>;
  tier: EnglishCandidateTier;
  variantKind?: EnglishTermVariantKind;
}

export class TBService {
  private static readonly TB_CANDIDATE_LIMIT = 200;

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

    const recognizer = this.getEnglishRecognizer(projectId);
    const recognizerCandidates = this.toEnglishCandidates(
      recognizer.scan(searchText.text, {
        hardBoundaryOffsets: searchText.hardBoundaryOffsets,
      }),
    );

    const dbCandidates = this.db.searchProjectTermEntries(projectId, searchText.text, {
      srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as EnglishRecognizerEntry[];
    const dbRecognizer = buildEnglishTermRecognizer(dbCandidates);
    const dbRecognizedCandidates = this.toEnglishCandidates(
      dbRecognizer.scan(searchText.text, {
        hardBoundaryOffsets: searchText.hardBoundaryOffsets,
      }),
      'dbFallback',
    );

    return this.mergeEnglishCandidates([...recognizerCandidates, ...dbRecognizedCandidates]);
  }

  private getEnglishRecognizer(projectId: number): EnglishTermRecognizer<EnglishRecognizerEntry> {
    const mountedTbs = this.db.getProjectMountedTermBases(projectId);
    const key = this.buildEnglishRecognizerCacheKey(mountedTbs);
    const cached = this.englishRecognizerCache.get(projectId);
    if (cached?.key === key) return cached.recognizer;

    const entries = this.db.listProjectTermEntries(projectId) as EnglishRecognizerEntry[];
    const recognizer = buildEnglishTermRecognizer(entries);
    this.englishRecognizerCache.set(projectId, { key, recognizer });
    return recognizer;
  }

  private buildEnglishRecognizerCacheKey(mountedTbs: MountedTBRecord[]): string {
    return mountedTbs.map((tb) => `${tb.id}:${tb.priority}:${tb.updatedAt}`).join('|');
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
      }))
      .sort((a, b) => {
        const candidateA = bySrcNorm.get(a.srcNorm);
        const candidateB = bySrcNorm.get(b.srcNorm);
        if (candidateA && candidateB) {
          return this.compareEnglishCandidates(candidateA, candidateB);
        }
        return 0;
      });

    return suppressNestedTermMatches(matches);
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
