import { type Segment, type TMEntry } from '@cat/core/models';
import {
  resolveTMTextProfile,
  serializeTokensToDisplayText,
  serializeTokensToTextOnly,
} from '@cat/core/text';
import { randomUUID } from 'crypto';
import type { ProjectRepository, TMRepository } from '../ports';
import { TMMatchScorer } from './TMMatchScoring';
import { finalizeTMMatches } from './TMMatchSelection';
import type { LocalOverlapResult, RankedTMMatch, TMMatch, TMRecallCandidate } from './TMMatchTypes';

export type {
  ConcordanceTMMatch,
  StandardTMMatch,
  TMMatch,
  TMMatchBase,
  TMMatchKind,
} from './TMMatchTypes';

export class TMService {
  private readonly matchScorer = new TMMatchScorer();

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly tmRepo: TMRepository,
  ) {}

  /**
   * Upsert a segment into the working TM of a project.
   */
  public upsertFromConfirmedSegment(projectId: number, segment: Segment) {
    const project = this.projectRepo.getProject(projectId);
    if (!project) return;

    const mountedTMs = this.tmRepo.getProjectMountedTMs(projectId);
    const workingTM = mountedTMs.find((tm) => {
      return tm.type === 'working' && (tm.permission === 'write' || tm.permission === 'readwrite');
    });

    if (!workingTM) {
      console.warn(`[TMService] No writable Working TM found for project ${projectId}`);
      return;
    }

    const entry: TMEntry & { tmId: string } = {
      id: randomUUID(),
      tmId: workingTM.id,
      projectId,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      srcHash: segment.srcHash,
      matchKey: segment.matchKey,
      tagsSignature: segment.tagsSignature,
      sourceTokens: segment.sourceTokens,
      targetTokens: segment.targetTokens,
      originSegmentId: segment.segmentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 1,
    };

    const entryId = this.tmRepo.upsertTMEntryBySrcHash(entry);
    this.tmRepo.replaceTMFts(
      workingTM.id,
      serializeTokensToDisplayText(segment.sourceTokens),
      serializeTokensToDisplayText(segment.targetTokens),
      entryId,
    );
  }

  /**
   * Find matches for a segment, including exact, fuzzy, and concordance matches.
   */
  public async findMatches(projectId: number, segment: Segment): Promise<TMMatch[]> {
    const mountedTMs = this.tmRepo.getProjectMountedTMs(projectId);
    if (mountedTMs.length === 0) return [];

    const textProfile = resolveTMTextProfile(this.projectRepo.getProject(projectId)?.srcLang);
    const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
    const sourceContext = this.matchScorer.createSourceContext(sourceTextOnly, textProfile);
    const results = this.collectExactMatches(mountedTMs, segment);
    const seenHashes = new Set(results.map((result) => result.match.srcHash));
    const recallCandidates = this.collectRecallCandidates({
      projectId,
      sourceTextOnly,
      tmIds: mountedTMs.map((tm) => tm.id),
      useEnglishProfile: textProfile === 'english',
    });

    for (const recall of recallCandidates) {
      if (seenHashes.has(recall.candidate.srcHash)) continue;
      const tm = mountedTMs.find((mountedTM) => mountedTM.id === recall.candidate.tmId);
      const rankedMatch = this.matchScorer.rankRecallCandidate({
        source: sourceContext,
        recall,
        tmName: tm?.name || 'Unknown TM',
        tmType: tm?.type || 'main',
      });
      if (!rankedMatch) continue;

      results.push(rankedMatch);
      seenHashes.add(recall.candidate.srcHash);
    }

    return finalizeTMMatches(results);
  }

  private collectExactMatches(
    mountedTMs: ReturnType<TMRepository['getProjectMountedTMs']>,
    segment: Segment,
  ): RankedTMMatch[] {
    const results: RankedTMMatch[] = [];
    for (const tm of mountedTMs) {
      const match = this.tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
      if (!match) continue;
      results.push({
        match: {
          ...match,
          kind: 'tm',
          similarity: 100,
          rank: 100,
          tmName: tm.name,
          tmType: tm.type,
        },
        diversityBucket: null,
      });
    }
    return results;
  }

  private collectRecallCandidates(params: {
    projectId: number;
    sourceTextOnly: string;
    tmIds: string[];
    useEnglishProfile: boolean;
  }): TMRecallCandidate[] {
    const recallOptions = params.useEnglishProfile ? ({ profile: 'english' } as const) : {};
    const fuzzyCandidates = this.tmRepo.searchTMFuzzyRecallCandidates(
      params.projectId,
      params.sourceTextOnly,
      params.tmIds,
      { scope: 'source', limit: 50, ...recallOptions },
    );
    const concordanceCandidates = this.tmRepo.searchTMConcordanceRecallCandidates(
      params.projectId,
      params.sourceTextOnly,
      params.tmIds,
      { scope: 'source', limit: 50, rawLimit: 200, ...recallOptions },
    );
    const candidateMap = new Map<string, TMRecallCandidate>();

    for (const candidate of fuzzyCandidates) {
      candidateMap.set(candidate.id, {
        candidate,
        fromFuzzy: true,
        fromConcordance: false,
      });
    }
    for (const candidate of concordanceCandidates) {
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
    return Array.from(candidateMap.values());
  }

  // These thin delegates preserve the existing diagnostic trace seam while scoring lives together.
  private normalizeForSimilarity(text: string): string {
    return this.matchScorer.normalizeForSimilarity(text);
  }

  private computeLocalOverlapSimilarity(a: string, b: string): LocalOverlapResult {
    return this.matchScorer.computeLocalOverlapSimilarity(a, b);
  }

  private promoteContainedConcordanceOverlap(localOverlap: LocalOverlapResult): LocalOverlapResult {
    return this.matchScorer.promoteContainedConcordanceOverlap(localOverlap);
  }

  private computeMaxLengthBound(a: string, b: string): number {
    return this.matchScorer.computeMaxLengthBound(a, b);
  }

  private computeLevenshteinSimilarity(a: string, b: string): number {
    return this.matchScorer.computeLevenshteinSimilarity(a, b);
  }

  private computeDiceSimilarity(a: string, b: string): number {
    return this.matchScorer.computeDiceSimilarity(a, b);
  }

  private computeSimilarityBonus(a: string, b: string): number {
    return this.matchScorer.computeSimilarityBonus(a, b);
  }

  private shouldClassifyLocalOverlapAsConcordance(
    standardSimilarity: number,
    localOverlap: LocalOverlapResult,
  ): boolean {
    return this.matchScorer.shouldClassifyLocalOverlapAsConcordance(
      standardSimilarity,
      localOverlap,
    );
  }

  private getExactNormalizedDiversityBucket(normalizedText: string): string | null {
    return this.matchScorer.getExactNormalizedDiversityBucket(normalizedText);
  }

  private getLocalOverlapDiversityBucket(localOverlap: LocalOverlapResult): string | null {
    return this.matchScorer.getLocalOverlapDiversityBucket(localOverlap);
  }
}
