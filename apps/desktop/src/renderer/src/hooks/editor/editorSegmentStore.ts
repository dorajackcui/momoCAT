import type { Segment } from '@cat/core/models';

export interface EditorSegmentChange {
  segmentId: string;
  previous: Segment;
  next: Segment;
}

export interface EditorSegmentStore {
  getSegments(): Segment[];
  getQARevision(): number;
  invalidateQA(): EditorSegmentChange[];
  getOrderIds(): readonly string[];
  getSegment(segmentId: string): Segment | undefined;
  getIndexById(): ReadonlyMap<string, number>;
  applyUpdates(updates: ReadonlyMap<string, Segment>): EditorSegmentChange[];
  applySameOrderSegments(
    nextSegments: readonly Segment[],
    changedSegmentIds: Iterable<string>,
  ): EditorSegmentChange[];
  updateSegment(
    segmentId: string,
    updater: (segment: Segment) => Segment,
  ): EditorSegmentChange | undefined;
  replaceAll(segments: readonly Segment[]): void;
  subscribeSegment(segmentId: string, listener: () => void): () => void;
}

export function createEditorSegmentStore(
  initialSegments: readonly Segment[] = [],
): EditorSegmentStore {
  let orderedSegments: Segment[] = [];
  let orderIds: string[] = [];
  let segmentById = new Map<string, Segment>();
  let indexById = new Map<string, number>();
  let qaSegmentIds = new Set<string>();
  let qaRevision = 0;
  const listenersBySegmentId = new Map<string, Set<() => void>>();

  const notifySegment = (segmentId: string): void => {
    for (const listener of [...(listenersBySegmentId.get(segmentId) ?? [])]) {
      listener();
    }
  };

  const replaceAll = (segments: readonly Segment[]): void => {
    qaRevision += 1;
    const previousById = segmentById;
    orderedSegments = [...segments];
    orderIds = orderedSegments.map((segment) => segment.segmentId);
    segmentById = new Map(orderedSegments.map((segment) => [segment.segmentId, segment]));
    indexById = new Map(orderIds.map((segmentId, index) => [segmentId, index]));
    qaSegmentIds = new Set(
      orderedSegments
        .filter((segment) => segment.qaIssues !== undefined)
        .map((segment) => segment.segmentId),
    );

    for (const segmentId of listenersBySegmentId.keys()) {
      if (previousById.get(segmentId) !== segmentById.get(segmentId)) {
        notifySegment(segmentId);
      }
    }
  };

  const applyUpdates = (updates: ReadonlyMap<string, Segment>): EditorSegmentChange[] => {
    const changes: EditorSegmentChange[] = [];
    const pending = new Map(updates);
    const changedFiles = new Set<number>();
    for (const [id, next] of pending) {
      const previous = segmentById.get(id);
      if (
        previous &&
        (JSON.stringify(previous.sourceTokens) !== JSON.stringify(next.sourceTokens) ||
          JSON.stringify(previous.targetTokens) !== JSON.stringify(next.targetTokens))
      )
        changedFiles.add(previous.fileId);
    }
    if (changedFiles.size) {
      qaRevision += 1;
    }

    for (const [segmentId, next] of pending) {
      const previous = segmentById.get(segmentId);
      const index = indexById.get(segmentId);
      if (!previous || index === undefined || next.segmentId !== segmentId || previous === next) {
        continue;
      }

      orderedSegments[index] = next;
      segmentById.set(segmentId, next);
      if (previous.qaIssues !== undefined && next.qaIssues === undefined) qaRevision += 1;
      if (next.qaIssues !== undefined) qaSegmentIds.add(segmentId);
      else qaSegmentIds.delete(segmentId);
      changes.push({ segmentId, previous, next });
    }

    for (const change of changes) {
      notifySegment(change.segmentId);
    }
    return changes;
  };

  replaceAll(initialSegments);

  return {
    getQARevision: () => qaRevision,
    invalidateQA: () => {
      qaRevision += 1;
      return applyUpdates(
        new Map(
          [...qaSegmentIds].map((id) => [id, { ...segmentById.get(id)!, qaIssues: undefined }]),
        ),
      );
    },
    getSegments: () => orderedSegments,
    getOrderIds: () => orderIds,
    getSegment: (segmentId) => segmentById.get(segmentId),
    getIndexById: () => indexById,
    applyUpdates,
    applySameOrderSegments: (nextSegments, changedSegmentIds) => {
      const updates = new Map<string, Segment>();
      for (const segmentId of changedSegmentIds) {
        const index = indexById.get(segmentId);
        if (index === undefined) continue;
        const next = nextSegments[index];
        if (next?.segmentId === segmentId) {
          updates.set(segmentId, next);
        }
      }
      return applyUpdates(updates);
    },
    updateSegment: (segmentId, updater) => {
      const previous = segmentById.get(segmentId);
      if (!previous) return undefined;
      return applyUpdates(new Map([[segmentId, updater(previous)]]))[0];
    },
    replaceAll,
    subscribeSegment: (segmentId, listener) => {
      const listeners = listenersBySegmentId.get(segmentId) ?? new Set<() => void>();
      listeners.add(listener);
      listenersBySegmentId.set(segmentId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersBySegmentId.delete(segmentId);
        }
      };
    },
  };
}
