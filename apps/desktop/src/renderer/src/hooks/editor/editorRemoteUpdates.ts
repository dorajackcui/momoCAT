import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { normalizeSegmentStatus } from '@cat/core/models';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import type { EditorSegmentChange, EditorSegmentStore } from './editorSegmentStore';

export type BatchSegmentAction =
  | { type: 'direct'; event: SegmentsUpdatedEvent }
  | { type: 'propagation'; event: SegmentsUpdatedEvent };

export function buildBatchFinalState(
  batch: SegmentsUpdatedEvent[],
): Map<string, BatchSegmentAction> {
  const finalState = new Map<string, BatchSegmentAction>();
  for (const data of batch) {
    finalState.set(data.segmentId, { type: 'direct', event: data });
    for (const propagatedId of data.propagatedIds ?? []) {
      finalState.set(propagatedId, { type: 'propagation', event: data });
    }
  }
  return finalState;
}

interface ApplyBatchSegmentUpdatesParams {
  finalState: Map<string, BatchSegmentAction>;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  directContext: string;
  propagationContext: string;
}

export function applyBatchSegmentUpdatesToStore({
  store,
  finalState,
  normalizeTokens,
  normalizeStatus,
  directContext,
  propagationContext,
}: ApplyBatchSegmentUpdatesParams & {
  store: EditorSegmentStore;
}): EditorSegmentChange[] {
  const updates = new Map<string, Segment>();

  for (const [segmentId, entry] of finalState) {
    const segment = store.getSegment(segmentId);
    if (!segment) continue;

    const nextSegment =
      entry.type === 'direct'
        ? applyDirectSegmentUpdate({
            segment,
            event: entry.event,
            normalizeTokens,
            normalizeStatus,
            context: directContext,
          })
        : applyPropagatedSegmentUpdate({
            segment,
            event: entry.event,
            normalizeTokens,
            context: propagationContext,
          });
    updates.set(segmentId, nextSegment);
  }

  return store.applyUpdates(updates);
}

function applyDirectSegmentUpdate(params: {
  segment: Segment;
  event: SegmentsUpdatedEvent;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  normalizeStatus: (status: unknown, targetTokens: Token[]) => SegmentStatus;
  context: string;
}): Segment {
  const targetTokens = params.normalizeTokens(
    params.event.targetTokens,
    `segment ${params.segment.segmentId} target (${params.context})`,
  );
  const nextStatus = params.normalizeStatus(params.event.status, targetTokens);
  return {
    ...params.segment,
    targetTokens,
    status: nextStatus,
    qaIssues: params.segment.qaIssues,
  };
}

function applyPropagatedSegmentUpdate(params: {
  segment: Segment;
  event: SegmentsUpdatedEvent;
  normalizeTokens: (tokens: unknown, context: string) => Token[];
  context: string;
}): Segment {
  const targetTokens = params.normalizeTokens(
    params.event.targetTokens,
    `segment ${params.segment.segmentId} target (${params.context})`,
  );
  const nextStatus = normalizeSegmentStatus(params.event.status, targetTokens);
  return {
    ...params.segment,
    targetTokens,
    status: nextStatus,
    qaIssues: params.segment.qaIssues,
  };
}

export interface RemoteUpdateQueueHandlers {
  activeFileId?: number | null;
  queuedRemoteUpdates: Map<string, SegmentsUpdatedEvent>;
  shouldDelayRemoteUpdate: (segmentId: string) => boolean;
  isRemoteUpdateStale: (segmentId: string, clientRequestId?: string) => boolean;
  applySegmentsUpdatedEvent: (data: SegmentsUpdatedEvent) => void;
  applySegmentsUpdatedBatch: (batch: SegmentsUpdatedEvent[]) => void;
}

function isSegmentUpdateForActiveFile(
  data: SegmentsUpdatedEvent,
  activeFileId: number | null | undefined,
): boolean {
  if (activeFileId === undefined) return true;
  if (activeFileId === null) return false;
  return data.fileId === activeFileId;
}

// An event rewrites its direct segment and every propagated segment, so a
// pending/editing state on any of them must delay the whole event. Otherwise a
// propagation into the actively edited segment replaces the editor content
// mid-typing and resets the caret.
export function isSegmentUpdateDelayed(
  data: SegmentsUpdatedEvent,
  shouldDelayRemoteUpdate: (segmentId: string) => boolean,
): boolean {
  return (
    shouldDelayRemoteUpdate(data.segmentId) ||
    (data.propagatedIds ?? []).some((segmentId) => shouldDelayRemoteUpdate(segmentId))
  );
}

export function handleIncomingSegmentsUpdatedEvent(
  data: SegmentsUpdatedEvent,
  handlers: RemoteUpdateQueueHandlers,
): 'ignored' | 'stale' | 'queued' | 'applied' {
  if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
    return 'ignored';
  }

  if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
    return 'stale';
  }

  if (isSegmentUpdateDelayed(data, handlers.shouldDelayRemoteUpdate)) {
    handlers.queuedRemoteUpdates.set(data.segmentId, data);
    return 'queued';
  }

  handlers.applySegmentsUpdatedEvent(data);
  return 'applied';
}

export function applyConfirmedSegmentUpdate(
  data: SegmentsUpdatedEvent,
  handlers: Pick<RemoteUpdateQueueHandlers, 'activeFileId' | 'queuedRemoteUpdates'> & {
    applyFinalState: (state: Map<string, BatchSegmentAction>) => void;
  },
  accept: (id: string) => boolean = () => true,
): void {
  if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) return;
  // Apply the accepted result before navigation and supersede its queued draft echoes.
  const finalState = buildBatchFinalState([data]);
  for (const id of finalState.keys()) {
    if (accept(id)) handlers.queuedRemoteUpdates.delete(id);
    else finalState.delete(id);
  }
  if (finalState.size) handlers.applyFinalState(finalState);
}

export function handleIncomingSegmentsUpdatedBatch(
  batch: SegmentsUpdatedEvent[],
  handlers: RemoteUpdateQueueHandlers,
): { applied: number; queued: number; stale: number } {
  const toApply: SegmentsUpdatedEvent[] = [];
  let queued = 0;
  let stale = 0;

  for (const data of batch) {
    if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
      continue;
    }

    if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
      stale += 1;
      continue;
    }
    if (isSegmentUpdateDelayed(data, handlers.shouldDelayRemoteUpdate)) {
      handlers.queuedRemoteUpdates.set(data.segmentId, data);
      queued += 1;
      continue;
    }
    toApply.push(data);
  }

  if (toApply.length > 0) {
    handlers.applySegmentsUpdatedBatch(toApply);
  }

  return { applied: toApply.length, queued, stale };
}

export function drainQueuedSegmentsUpdatedEvents(handlers: RemoteUpdateQueueHandlers): {
  appliedCount: number;
  droppedStaleCount: number;
} {
  let droppedStaleCount = 0;
  const toApply: SegmentsUpdatedEvent[] = [];
  const queued = [...handlers.queuedRemoteUpdates.values()];

  for (const data of queued) {
    if (!isSegmentUpdateForActiveFile(data, handlers.activeFileId)) {
      handlers.queuedRemoteUpdates.delete(data.segmentId);
      continue;
    }

    if (handlers.isRemoteUpdateStale(data.segmentId, data.clientRequestId)) {
      handlers.queuedRemoteUpdates.delete(data.segmentId);
      droppedStaleCount += 1;
      continue;
    }

    if (isSegmentUpdateDelayed(data, handlers.shouldDelayRemoteUpdate)) {
      continue;
    }

    handlers.queuedRemoteUpdates.delete(data.segmentId);
    toApply.push(data);
  }

  if (toApply.length > 0) {
    handlers.applySegmentsUpdatedBatch(toApply);
  }

  return { appliedCount: toApply.length, droppedStaleCount };
}
