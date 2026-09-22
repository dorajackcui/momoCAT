import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { normalizeSegmentStatus } from '@cat/core/models';
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

interface SegmentUpdateOptions {
  commitToWorkingTM?: boolean;
  propagateRepeats?: boolean;
}

interface SegmentUpdateEventPayload extends SegmentUpdateInput {
  fileId: number;
  propagatedIds: string[];
  serverAppliedAt: string;
}

export interface WorkingTMUpdatedPayload {
  projectId: number;
  srcHash: string;
}

interface SegmentUpdateInternalResult {
  fileId: number;
  propagatedIds: string[];
  workingTMUpdate?: WorkingTMUpdatedPayload;
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
    status = normalizeSegmentStatus(status, targetTokens);
    const { fileId, propagatedIds, workingTMUpdate } = this.tx.runInTransaction(() =>
      this.updateSegmentInternal(segmentId, targetTokens, status),
    );
    const serverAppliedAt = new Date().toISOString();

    this.emitSegmentUpdated({
      fileId,
      segmentId,
      targetTokens,
      status,
      propagatedIds,
      clientRequestId,
      serverAppliedAt,
    });
    if (workingTMUpdate) {
      this.emitWorkingTMUpdated(workingTMUpdate);
    }

    return { fileId, propagatedIds, clientRequestId, serverAppliedAt };
  }

  /**
   * Update multiple segments in one transaction with all-or-nothing semantics.
   * Events are emitted only after transaction commit.
   */
  public async updateSegmentsAtomically(
    updates: SegmentUpdateInput[],
    options: SegmentUpdateOptions = {},
  ): Promise<SegmentUpdateEventPayload[]> {
    if (updates.length === 0) return [];

    return this.runSegmentUpdatesAtomically(
      (applyUpdate) => updates.map((update) => applyUpdate(update)),
      options,
    );
  }

  /**
   * Run a synchronous segment batch and any related persistence writes in one
   * transaction. Segment events are emitted only after the whole operation
   * commits successfully.
   */
  public runSegmentUpdatesAtomically<T>(
    operation: (applyUpdate: (update: SegmentUpdateInput) => SegmentUpdateEventPayload) => T,
    options: SegmentUpdateOptions = {},
  ): T {
    const workingTMUpdates = new Map<string, WorkingTMUpdatedPayload>();
    const { result, events } = this.tx.runInTransaction(() => {
      const pendingEvents: SegmentUpdateEventPayload[] = [];
      const applyUpdate = (update: SegmentUpdateInput): SegmentUpdateEventPayload => {
        update = { ...update, status: normalizeSegmentStatus(update.status, update.targetTokens) };
        const { fileId, propagatedIds, workingTMUpdate } = this.updateSegmentInternal(
          update.segmentId,
          update.targetTokens,
          update.status,
          options,
        );
        if (workingTMUpdate) {
          workingTMUpdates.set(
            JSON.stringify([workingTMUpdate.projectId, workingTMUpdate.srcHash]),
            workingTMUpdate,
          );
        }
        const event = {
          ...update,
          fileId,
          propagatedIds,
          serverAppliedAt: new Date().toISOString(),
        };
        pendingEvents.push(event);
        return event;
      };

      return {
        result: operation(applyUpdate),
        events: pendingEvents,
      };
    });

    for (const event of events) {
      this.emitSegmentUpdated(event);
    }
    for (const update of workingTMUpdates.values()) {
      this.emitWorkingTMUpdated(update);
    }

    return result;
  }

  private updateSegmentInternal(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    options: SegmentUpdateOptions = {},
  ): SegmentUpdateInternalResult {
    const existingSegment = this.db.getSegment(segmentId);
    if (!existingSegment) {
      throw new Error(`Segment not found: ${segmentId}`);
    }

    const fileId = existingSegment.fileId;
    this.db.updateSegmentTarget(segmentId, targetTokens, status);

    let propagatedIds: string[] = [];
    let workingTMUpdate: WorkingTMUpdatedPayload | undefined;

    if (status === 'confirmed') {
      const projectType = this.db.getProjectTypeByFileId(fileId) ?? 'translation';
      if (projectType !== 'translation') {
        return { fileId, propagatedIds: [] };
      }

      const projectId = this.db.getProjectIdByFileId(fileId);
      if (projectId !== undefined) {
        const segment = this.db.getSegment(segmentId) ?? existingSegment;
        if (options.commitToWorkingTM !== false) {
          this.tmService.upsertFromConfirmedSegment(projectId, segment);
          workingTMUpdate = { projectId, srcHash: segment.srcHash };
        }
        if (options.propagateRepeats !== false) {
          propagatedIds = this.propagate(projectId, segment);
        }
      }
    }

    return { fileId, propagatedIds, workingTMUpdate };
  }

  private emitSegmentUpdated(payload: SegmentUpdateEventPayload) {
    this.emit('segments-updated', payload);
  }

  private emitWorkingTMUpdated(payload: WorkingTMUpdatedPayload) {
    this.emit('working-tm-updated', payload);
  }

  /**
   * Only the first occurrence in a file propagates; every later repeat receives its confirmation.
   */
  private propagate(projectId: number, sourceSegment: Segment): string[] {
    const cohort = this.db.getProjectSegmentsByHash(
      projectId,
      sourceSegment.srcHash,
      sourceSegment.fileId,
    );
    if (cohort.some((segment) => segment.orderIndex < sourceSegment.orderIndex)) return [];

    const sourceTargetSignature = JSON.stringify(sourceSegment.targetTokens);
    const repeats = cohort.filter(
      (segment) =>
        segment.orderIndex > sourceSegment.orderIndex &&
        (segment.status !== 'confirmed' ||
          JSON.stringify(segment.targetTokens) !== sourceTargetSignature),
    );

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

      this.db.updateSegmentTarget(seg.segmentId, sourceSegment.targetTokens, 'confirmed');
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
      this.db.updateSegmentTarget(
        change.segmentId,
        change.oldTargetTokens,
        change.oldStatus,
      );
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
