import { randomUUID } from 'crypto';
import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type {
  ProjectRepository,
  SegmentRepository,
  TMRepository,
  TransactionManager,
} from '../../ports';
import { SegmentService } from '../../SegmentService';
import type { TMCommitOptions, TMCommitScope } from '../../../../shared/ipc';

export interface TMFileCommitResult {
  committedCount: number;
  projectId: number;
  tmType: 'working' | 'main';
}

export class TMBatchOpsService {
  private static readonly SEGMENT_PAGE_SIZE = 2000;

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly tmRepo: TMRepository,
    private readonly tx: TransactionManager,
    private readonly segmentService: SegmentService,
  ) {}

  public async commitFileToTM(
    tmId: string,
    fileId: number,
    options?: TMCommitOptions,
  ): Promise<TMFileCommitResult> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');

    const tm = this.tmRepo.getTM(tmId);
    if (!tm) throw new Error('Target TM not found');

    if (tm.type === 'working') {
      const project = this.projectRepo.getProject(file.projectId);
      if (!project) throw new Error('Project not found');
      if ((project.projectType ?? 'translation') !== 'translation') {
        throw new Error('Only translation projects can commit to Working TM');
      }

      const mountedWorkingTM = this.tmRepo
        .getProjectMountedTMs(file.projectId)
        .find((mounted) => mounted.id === tmId && mounted.type === 'working');
      if (
        !mountedWorkingTM ||
        (mountedWorkingTM.permission !== 'write' && mountedWorkingTM.permission !== 'readwrite')
      ) {
        throw new Error("Target TM is not this file project's writable Working TM");
      }
    }

    const scope = this.normalizeCommitScope(options);
    const committedCount = this.tx.runInTransaction(() => {
      let count = 0;

      this.forEachFileSegment(fileId, (segment) => {
        const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
        const targetText = serializeTokensToDisplayText(segment.targetTokens);
        if (!this.shouldCommitSegment(segment, scope, sourceText, targetText)) return;

        const entryId = this.tmRepo.upsertTMEntryBySrcHash({
          id: randomUUID(),
          tmId,
          projectId: file.projectId,
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

        this.tmRepo.replaceTMFts(tmId, sourceText, targetText, entryId);
        count += 1;
      });

      return count;
    });

    return {
      committedCount,
      projectId: file.projectId,
      tmType: tm.type,
    };
  }

  /** @deprecated Use commitFileToTM for targets that may include Working TM. */
  public async commitToMainTM(tmId: string, fileId: number, options?: TMCommitOptions) {
    const result = await this.commitFileToTM(tmId, fileId, options);
    return result.committedCount;
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
      await this.segmentService.updateSegmentsAtomically(updates, {
        commitToWorkingTM: false,
        preserveRepeatLink: true,
      });
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

  private normalizeCommitScope(options?: TMCommitOptions): TMCommitScope {
    return options?.scope === 'all' ? 'all' : 'confirmed-only';
  }

  private shouldCommitSegment(
    segment: Segment,
    scope: TMCommitScope,
    sourceText: string,
    targetText: string,
  ): boolean {
    if (scope === 'confirmed-only') {
      return segment.status === 'confirmed';
    }

    return sourceText.trim().length > 0 && targetText.trim().length > 0;
  }
}
