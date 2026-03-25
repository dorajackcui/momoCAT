import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { TMService } from './TMService';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { SegmentRepository, TransactionManager } from './ports';

interface PropagationBatch {
  id: string;
  projectId: number;
  timestamp: string;
  changes: {
    segmentId: string;
    oldTargetTokens: Token[];
    oldStatus: SegmentStatus;
  }[];
}

interface SegmentUpdateInput {
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  clientRequestId?: string;
}

interface SegmentUpdateEventPayload extends SegmentUpdateInput {
  propagatedIds: string[];
  serverAppliedAt: string;
}

export class SegmentService extends EventEmitter {
  private db: SegmentRepository;
  private tmService: TMService;
  private tx: TransactionManager;
  private lastBatch: PropagationBatch | null = null;

  constructor(db: SegmentRepository, tmService: TMService, tx: TransactionManager) {
    super();
    this.db = db;
    this.tmService = tmService;
    this.tx = tx;
  }

  public getSegments(fileId: number, offset: number, limit: number): Segment[] {
    return this.db.getSegmentsPage(fileId, offset, limit);
  }

  /**
   * Update segment target and status, ensuring file stats and TM are updated
   */
  public async updateSegment(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    clientRequestId?: string,
  ) {
    const { propagatedIds } = this.tx.runInTransaction(() =>
      this.updateSegmentInternal(segmentId, targetTokens, status),
    );
    const serverAppliedAt = new Date().toISOString();

    this.emitSegmentUpdated({
      segmentId,
      targetTokens,
      status,
      propagatedIds,
      clientRequestId,
      serverAppliedAt,
    });

    return { propagatedIds, clientRequestId, serverAppliedAt };
  }

  /**
   * Update multiple segments in one transaction with all-or-nothing semantics.
   * Events are emitted only after transaction commit.
   */
  public async updateSegmentsAtomically(
    updates: SegmentUpdateInput[],
  ): Promise<SegmentUpdateEventPayload[]> {
    if (updates.length === 0) return [];

    const events = this.tx.runInTransaction(() =>
      updates.map((update) => {
        const { propagatedIds } = this.updateSegmentInternal(
          update.segmentId,
          update.targetTokens,
          update.status,
        );
        return {
          ...update,
          propagatedIds,
          serverAppliedAt: new Date().toISOString(),
        };
      }),
    );

    for (const event of events) {
      this.emitSegmentUpdated(event);
    }

    return events;
  }

  private updateSegmentInternal(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
  ): { propagatedIds: string[] } {
    this.db.updateSegmentTarget(segmentId, targetTokens, status);

    let propagatedIds: string[] = [];

    if (status === 'confirmed') {
      const segment = this.db.getSegment(segmentId);
      if (segment) {
        const projectType = this.db.getProjectTypeByFileId(segment.fileId) ?? 'translation';
        if (projectType !== 'translation') {
          return { propagatedIds: [] };
        }

        const projectId = this.db.getProjectIdByFileId(segment.fileId);
        if (projectId !== undefined) {
          this.tmService.upsertFromConfirmedSegment(projectId, segment);
          propagatedIds = this.propagate(projectId, segment);
        }
      }
    }

    return { propagatedIds };
  }

  private emitSegmentUpdated(payload: SegmentUpdateEventPayload) {
    this.emit('segments-updated', payload);
  }

  /**
   * Propagate translation to all identical segments in the project
   */
  private propagate(projectId: number, sourceSegment: Segment): string[] {
    console.log(
      `[SegmentService] Propagating segment ${sourceSegment.segmentId} in project ${projectId}`,
    );

    // Find segments with same srcHash in the same project (across files)
    const repeats = this.db
      .getProjectSegmentsByHash(projectId, sourceSegment.srcHash)
      .filter((s: Segment) => s.segmentId !== sourceSegment.segmentId && s.status !== 'confirmed');

    if (repeats.length === 0) return [];

    const batch: PropagationBatch = {
      id: randomUUID(),
      projectId,
      timestamp: new Date().toISOString(),
      changes: [],
    };

    const updatedIds: string[] = [];

    for (const seg of repeats) {
      // Record for undo
      batch.changes.push({
        segmentId: seg.segmentId,
        oldTargetTokens: seg.targetTokens,
        oldStatus: seg.status,
      });

      // Update segment (using draft status for propagated translations)
      this.db.updateSegmentTarget(seg.segmentId, sourceSegment.targetTokens, 'draft');
      updatedIds.push(seg.segmentId);
    }

    this.lastBatch = batch;
    console.log(`[SegmentService] Propagated to ${repeats.length} segments. Batch ID: ${batch.id}`);
    return updatedIds;
  }

  public async undoLastPropagation() {
    if (!this.lastBatch) return;

    console.log(`[SegmentService] Undoing propagation batch: ${this.lastBatch.id}`);
    for (const change of this.lastBatch.changes) {
      this.db.updateSegmentTarget(change.segmentId, change.oldTargetTokens, change.oldStatus);
    }

    this.lastBatch = null;
  }

  public async confirmSegment(segmentId: string) {
    const segment = this.db.getSegment(segmentId);
    if (segment) {
      await this.updateSegment(segmentId, segment.targetTokens, 'confirmed');
    }
  }

  public async bulkUpdateStatus(segmentIds: string[], status: SegmentStatus) {
    // For now, simple loop. In production, use transaction.
    for (const id of segmentIds) {
      const seg = this.db.getSegment(id);
      if (seg) {
        await this.updateSegment(id, seg.targetTokens, status);
      }
    }
  }
}
