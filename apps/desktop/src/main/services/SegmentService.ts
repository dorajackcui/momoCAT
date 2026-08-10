import type { RepeatPropagationState, Segment, SegmentStatus, Token } from '@cat/core/models';
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
    oldRepeatPropagation?: RepeatPropagationState;
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
  preserveRepeatLink?: boolean;
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

    const workingTMUpdates = new Map<string, WorkingTMUpdatedPayload>();
    const events = this.tx.runInTransaction(() =>
      updates.map((update) => {
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
        return {
          ...update,
          fileId,
          propagatedIds,
          serverAppliedAt: new Date().toISOString(),
        };
      }),
    );

    for (const event of events) {
      this.emitSegmentUpdated(event);
    }
    for (const update of workingTMUpdates.values()) {
      this.emitWorkingTMUpdated(update);
    }

    return events;
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
    const projectType = this.db.getProjectTypeByFileId(fileId) ?? 'translation';
    const projectId =
      projectType === 'translation' ? this.db.getProjectIdByFileId(fileId) : undefined;
    const sameSourceSegments =
      projectId === undefined ? [] : this.getRepeatCohort(projectId, existingSegment);
    const currentSegment =
      sameSourceSegments.find((segment) => segment.segmentId === segmentId) ?? existingSegment;
    const previousTargetSignature = this.targetSignature(currentSegment);
    const nextTargetSignature = JSON.stringify(targetTokens);
    const storedRepeatState = currentSegment.meta.repeatPropagation;
    const participatesInRepeatCohort = sameSourceSegments.length > 1;
    const leader = sameSourceSegments[0];
    const isLeader = participatesInRepeatCohort && leader?.segmentId === segmentId;

    if (isLeader && (status === 'confirmed' || nextTargetSignature !== previousTargetSignature)) {
      this.materializeRepeatFollowers(sameSourceSegments);
    }

    let nextRepeatState = this.resolveRepeatState(
      currentSegment,
      leader,
      participatesInRepeatCohort,
    );

    if (!participatesInRepeatCohort) {
      nextRepeatState = undefined;
    } else if (
      !isLeader &&
      !options.preserveRepeatLink &&
      (status === 'confirmed' ||
        ((status === 'draft' || status === 'new') &&
          nextTargetSignature !== previousTargetSignature))
    ) {
      // A manual edit or direct confirmation of a later occurrence opts it
      // out of the first occurrence's propagation chain.
      nextRepeatState = { mode: 'detached' };
    }

    const repeatPropagationUpdate = this.repeatStatesEqual(storedRepeatState, nextRepeatState)
      ? undefined
      : (nextRepeatState ?? null);
    this.db.updateSegmentTarget(segmentId, targetTokens, status, repeatPropagationUpdate);

    let propagatedIds: string[] = [];
    let workingTMUpdate: WorkingTMUpdatedPayload | undefined;

    if (status === 'confirmed') {
      const segment = this.db.getSegment(segmentId) ?? existingSegment;
      if (projectType !== 'translation') {
        return { fileId, propagatedIds: [] };
      }

      if (projectId !== undefined) {
        if (options.commitToWorkingTM !== false) {
          this.tmService.upsertFromConfirmedSegment(projectId, segment);
          workingTMUpdate = { projectId, srcHash: segment.srcHash };
        }
        if (nextRepeatState?.mode === 'leader') {
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
   * Propagate a leading occurrence to later, still-following occurrences.
   */
  private propagate(projectId: number, sourceSegment: Segment): string[] {
    console.log(
      `[SegmentService] Propagating segment ${sourceSegment.segmentId} in project ${projectId}`,
    );

    const sourceTargetSignature = this.targetSignature(sourceSegment);
    const repeats = this.db
      .getProjectSegmentsByHash(projectId, sourceSegment.srcHash, sourceSegment.fileId)
      .filter((segment: Segment) => {
        if (!this.isEarlierInFile(sourceSegment, segment)) return false;
        return (
          segment.meta.repeatPropagation?.mode === 'following' &&
          segment.meta.repeatPropagation.sourceSegmentId === sourceSegment.segmentId
        );
      });

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
        oldRepeatPropagation: seg.meta.repeatPropagation,
      });

      const alreadyApplied =
        seg.status === 'confirmed' && this.targetSignature(seg) === sourceTargetSignature;
      if (!alreadyApplied) {
        this.db.updateSegmentTarget(seg.segmentId, sourceSegment.targetTokens, 'confirmed', {
          mode: 'following',
          sourceSegmentId: sourceSegment.segmentId,
        });
        updatedIds.push(seg.segmentId);
      }
    }

    this.lastBatch = batch;
    console.log(`[SegmentService] Propagated to ${repeats.length} segments. Batch ID: ${batch.id}`);
    return updatedIds;
  }

  private getRepeatCohort(projectId: number, segment: Segment): Segment[] {
    return this.db
      .getProjectSegmentsByHash(projectId, segment.srcHash, segment.fileId)
      .sort((left, right) => left.orderIndex - right.orderIndex);
  }

  private materializeRepeatFollowers(cohort: Segment[]): void {
    const leader = cohort[0];
    for (const candidate of cohort.slice(1)) {
      const storedState = candidate.meta.repeatPropagation;
      const nextState = this.resolveRepeatState(candidate, leader, true);

      if (nextState && !this.repeatStatesEqual(storedState, nextState)) {
        this.db.updateSegmentRepeatPropagation(candidate.segmentId, nextState);
      }
    }
  }

  private resolveRepeatState(
    candidate: Segment,
    leader: Segment | undefined,
    participatesInRepeatCohort: boolean,
  ): RepeatPropagationState | undefined {
    if (!leader || !participatesInRepeatCohort) return undefined;
    if (candidate.segmentId === leader.segmentId) return { mode: 'leader' };

    const storedState = candidate.meta.repeatPropagation;
    if (storedState?.mode === 'detached') return storedState;
    if (storedState?.mode === 'following' && storedState.sourceSegmentId === leader.segmentId) {
      return storedState;
    }
    if (
      !this.hasTargetContent(candidate) ||
      this.targetSignature(candidate) === this.targetSignature(leader)
    ) {
      return { mode: 'following', sourceSegmentId: leader.segmentId };
    }
    return { mode: 'detached' };
  }

  private hasTargetContent(segment: Segment): boolean {
    return segment.targetTokens.some((token) => token.content.trim().length > 0);
  }

  private targetSignature(segment: Segment): string {
    return JSON.stringify(segment.targetTokens);
  }

  private isEarlierInFile(left: Segment, right: Segment): boolean {
    return left.fileId === right.fileId && left.orderIndex < right.orderIndex;
  }

  private repeatStatesEqual(
    left: RepeatPropagationState | undefined,
    right: RepeatPropagationState | undefined,
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  public async undoLastPropagation() {
    if (!this.lastBatch) return;

    console.log(`[SegmentService] Undoing propagation batch: ${this.lastBatch.id}`);
    for (const change of this.lastBatch.changes) {
      this.db.updateSegmentTarget(
        change.segmentId,
        change.oldTargetTokens,
        change.oldStatus,
        change.oldRepeatPropagation ?? null,
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
