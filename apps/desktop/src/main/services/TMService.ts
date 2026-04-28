import { type Segment, type TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText, serializeTokensToTextOnly } from '@cat/core/text';
import { randomUUID } from 'crypto';
import { distance } from 'fastest-levenshtein';
import { ProjectRepository, TMRepository } from './ports';

export interface TMMatch extends TMEntry {
  similarity: number;
  tmName: string;
  tmType: 'working' | 'main';
}

export class TMService {
  private static readonly TM_MATCH_RESULT_LIMIT = 10;
  private static readonly MIN_SIMILARITY = 50;
  private static readonly LEVENSHTEIN_WEIGHT = 0.75;
  private static readonly DICE_WEIGHT = 0.25;

  private projectRepo: ProjectRepository;
  private tmRepo: TMRepository;

  constructor(projectRepo: ProjectRepository, tmRepo: TMRepository) {
    this.projectRepo = projectRepo;
    this.tmRepo = tmRepo;
  }

  /**
   * Upsert a segment into the working TM of a project
   */
  public upsertFromConfirmedSegment(projectId: number, segment: Segment) {
    const project = this.projectRepo.getProject(projectId);
    if (!project) return;

    // V5: Find the writable TM (Working TM) for this project
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
      projectId: projectId, // Keep for compatibility if needed in core type
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
   * Find matches for a segment, including 100% and fuzzy matches.
   */
  public async findMatches(projectId: number, segment: Segment): Promise<TMMatch[]> {
    const mountedTMs = this.tmRepo.getProjectMountedTMs(projectId);
    if (mountedTMs.length === 0) return [];

    const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
    const sourceNormalized = this.normalizeForSimilarity(sourceTextOnly);

    const results: TMMatch[] = [];
    const seenHashes = new Set<string>();

    // 1. First, check for 100% matches (exact hash)
    for (const tm of mountedTMs) {
      const match = this.tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
      if (match) {
        results.push({
          ...match,
          similarity: 100,
          tmName: tm.name,
          tmType: tm.type,
        });
        seenHashes.add(match.srcHash);
      }
    }

    // 2. Fuzzy matching using FTS as a candidate filter
    // Construct query from meaningful words
    const query = sourceTextOnly
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .join(' OR ');

    if (query) {
      const candidates = this.tmRepo.searchConcordance(projectId, query);

      for (const cand of candidates) {
        if (seenHashes.has(cand.srcHash)) continue;

        const candTextOnly = serializeTokensToTextOnly(cand.sourceTokens);
        const candNormalized = this.normalizeForSimilarity(candTextOnly);

        let similarity = 0;

        // Logic A: Text is identical, but Tags are different
        if (sourceNormalized === candNormalized) {
          similarity = 99; // Penalty for tag mismatch
        } else {
          const localOverlapSimilarity = this.computeLocalOverlapSimilarity(
            sourceNormalized,
            candNormalized,
          );
          const maxPossibleByLength = this.computeMaxLengthBound(sourceNormalized, candNormalized);
          let weightedSimilarity = 0;

          if (maxPossibleByLength >= TMService.MIN_SIMILARITY) {
            const levSimilarity = this.computeLevenshteinSimilarity(sourceNormalized, candNormalized);
            const diceSimilarity = this.computeDiceSimilarity(sourceNormalized, candNormalized);
            const bonus = this.computeSimilarityBonus(sourceNormalized, candNormalized);
            weightedSimilarity = Math.min(
              99,
              Math.round(
                levSimilarity * TMService.LEVENSHTEIN_WEIGHT +
                  diceSimilarity * TMService.DICE_WEIGHT +
                  bonus,
              ),
            );
          }

          similarity = Math.max(weightedSimilarity, localOverlapSimilarity);
        }

        if (similarity >= TMService.MIN_SIMILARITY) {
          const tm = mountedTMs.find((t) => t.id === cand.tmId);
          results.push({
            ...cand,
            similarity,
            tmName: tm?.name || 'Unknown TM',
            tmType: tm?.type || 'main',
          });
          seenHashes.add(cand.srcHash);
        }
      }
    }

    // Sort by similarity desc, then by usageCount desc
    return results
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        return b.usageCount - a.usageCount;
      })
      .slice(0, TMService.TM_MATCH_RESULT_LIMIT);
  }

  private normalizeForSimilarity(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private computeMaxLengthBound(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    return Math.floor((1 - Math.abs(a.length - b.length) / maxLen) * 100);
  }

  private computeLevenshteinSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    const levDist = distance(a, b);
    return Math.max(0, Math.round((1 - levDist / maxLen) * 100));
  }

  private computeDiceSimilarity(a: string, b: string): number {
    if (!a && !b) return 100;
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.length < 2 || b.length < 2) return 0;

    const aBigrams = this.buildBigramCounts(a);
    const bBigrams = this.buildBigramCounts(b);

    let overlap = 0;
    let aCount = 0;
    let bCount = 0;

    for (const count of aBigrams.values()) {
      aCount += count;
    }
    for (const count of bBigrams.values()) {
      bCount += count;
    }
    for (const [gram, aGramCount] of aBigrams.entries()) {
      const bGramCount = bBigrams.get(gram) ?? 0;
      overlap += Math.min(aGramCount, bGramCount);
    }

    if (aCount + bCount === 0) return 0;
    return Math.round(((2 * overlap) / (aCount + bCount)) * 100);
  }

  private buildBigramCounts(text: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const gram = text.slice(i, i + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  }

  private computeSimilarityBonus(a: string, b: string): number {
    const shorterLen = Math.min(a.length, b.length);
    let bonus = 0;

    if (shorterLen >= 6 && (a.includes(b) || b.includes(a))) {
      bonus += 4;
    }

    const prefixLength = Math.min(4, shorterLen);
    if (prefixLength > 0 && a.slice(0, prefixLength) === b.slice(0, prefixLength)) {
      bonus += 2;
    }

    return bonus;
  }

  private computeLocalOverlapSimilarity(a: string, b: string): number {
    const longest = this.findLongestCommonSubstring(a, b);
    const overlapLength = longest.length;
    if (overlapLength < 2) return 0;

    const aLength = Array.from(a).length;
    const bLength = Array.from(b).length;
    const shorterLength = Math.min(aLength, bLength);
    const longerLength = Math.max(aLength, bLength);
    if (shorterLength === 0 || longerLength === 0) return 0;

    const shorterCoverage = overlapLength / shorterLength;
    const longerCoverage = overlapLength / longerLength;
    let score = Math.round(shorterCoverage * 70 + longerCoverage * 30);
    const hasSharedComponent = this.hasSharedCjkComponent(a, b);

    if (!hasSharedComponent && longerCoverage < 0.45) {
      score = Math.min(score, TMService.MIN_SIMILARITY - 1);
    }

    if (hasSharedComponent) {
      score = Math.max(score, 50);
    }

    return Math.min(99, score);
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

  private hasSharedCjkComponent(a: string, b: string): boolean {
    const aComponents = this.extractCjkComponents(a);
    const bComponents = new Set(this.extractCjkComponents(b));
    return aComponents.some((component) => bComponents.has(component));
  }

  private extractCjkComponents(text: string): string[] {
    return text
      .split(/[^\u4e00-\u9fa5]+/g)
      .map((component) => component.trim())
      .filter((component) => component.length >= 2);
  }

}
