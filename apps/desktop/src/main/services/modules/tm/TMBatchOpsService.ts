import { randomUUID } from 'crypto';
import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { ProjectRepository, SegmentRepository, TMRepository } from '../../ports';
import { SegmentService } from '../../SegmentService';

export class TMBatchOpsService {
  private static readonly SEGMENT_PAGE_SIZE = 2000;

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly tmRepo: TMRepository,
    private readonly segmentService: SegmentService,
  ) {}

  public async commitToMainTM(tmId: string, fileId: number) {
    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');

    let confirmedCount = 0;

    this.forEachFileSegment(fileId, (segment) => {
      if (segment.status !== 'confirmed') return;
      confirmedCount += 1;

      const entryId = this.tmRepo.upsertTMEntryBySrcHash({
        id: randomUUID(),
        tmId,
        projectId: 0,
        srcLang: tm.srcLang,
        tgtLang: tm.tgtLang,
        srcHash: segment.srcHash,
        matchKey: segment.matchKey,
        tagsSignature: segment.tagsSignature,
        sourceTokens: segment.sourceTokens,
        targetTokens: segment.targetTokens,
        originSegmentId: segment.segmentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 1,
      });

      this.tmRepo.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(segment.sourceTokens),
        serializeTokensToDisplayText(segment.targetTokens),
        entryId,
      );
    });

    return confirmedCount;
  }

  public async batchMatchFileWithTM(
    fileId: number,
    tmId: string,
  ): Promise<{ total: number; matched: number; applied: number; skipped: number }> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');

    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('TM not found');

    const mountedTMs = this.tmRepo.getProjectMountedTMs(file.projectId);
    if (!mountedTMs.some((mounted) => mounted.id === tmId)) {
      throw new Error('TM is not mounted to this file project');
    }

    let total = 0;
    let matched = 0;
    let skipped = 0;
    const updates: Array<{
      segmentId: string;
      targetTokens: Segment['targetTokens'];
      status: 'confirmed';
    }> = [];

    this.forEachFileSegment(fileId, (segment) => {
      total += 1;
      const match = this.tmRepo.findTMEntryByHash(tmId, segment.srcHash);
      if (!match) return;

      matched += 1;
      if (segment.status === 'confirmed') {
        skipped += 1;
        return;
      }

      updates.push({
        segmentId: segment.segmentId,
        targetTokens: match.targetTokens,
        status: 'confirmed',
      });
    });

    if (updates.length > 0) {
      await this.segmentService.updateSegmentsAtomically(updates);
    }

    return {
      total,
      matched,
      applied: updates.length,
      skipped,
    };
  }

  private forEachFileSegment(fileId: number, visitor: (segment: Segment) => void): void {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const page = this.segmentRepo.getSegmentsPage(
        fileId,
        offset,
        TMBatchOpsService.SEGMENT_PAGE_SIZE,
      );
      if (page.length === 0) break;
      for (const segment of page) {
        visitor(segment);
      }
      hasMore = page.length === TMBatchOpsService.SEGMENT_PAGE_SIZE;
      offset += TMBatchOpsService.SEGMENT_PAGE_SIZE;
    }
  }
}
