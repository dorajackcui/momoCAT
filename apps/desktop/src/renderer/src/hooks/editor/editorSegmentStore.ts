import type { Segment } from '@cat/core/models';
import type { FileQaIssueRecord } from '@cat/core/project';
import {
  buildSegmentStats,
  updateSegmentStatsFromChanges,
  type SegmentStats,
} from './editorSegmentState';

export interface EditorSegmentChange {
  segmentId: string;
  previous: Segment;
  next: Segment;
}

export interface EditorQAResults {
  hasResults: boolean;
  issues: FileQaIssueRecord[];
}

/** The store owns publication. Callers never need a separate React change hint. */
export interface EditorSegmentStore {
  getSegments(): Segment[];
  getOrderIds(): readonly string[];
  getSegment(segmentId: string): Segment | undefined;
  getIndexById(): ReadonlyMap<string, number>;
  getStats(): SegmentStats;
  getQARevision(): number;
  getQAResults(): EditorQAResults;
  invalidateQA(): EditorSegmentChange[];
  applyUpdates(updates: ReadonlyMap<string, Segment>): EditorSegmentChange[];
  updateSegment(segmentId: string, updater: (segment: Segment) => Segment): Segment | undefined;
  replaceAll(segments: readonly Segment[]): void;
  subscribe(listener: () => void): () => void;
  subscribeSegment(segmentId: string, listener: () => void): () => void;
}

function sameTokens(left: Segment['targetTokens'], right: Segment['targetTokens']): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function createEditorSegmentStore(
  initialSegments: readonly Segment[] = [],
): EditorSegmentStore {
  let orderedSegments: Segment[] = [];
  let orderIds: string[] = [];
  let segmentById = new Map<string, Segment>();
  let indexById = new Map<string, number>();
  let stats = buildSegmentStats([]);
  let qaSegmentIds = new Set<string>();
  let qaRevision = 0;
  let qaResults: EditorQAResults | null = null;
  const listeners = new Set<() => void>();
  const listenersBySegmentId = new Map<string, Set<() => void>>();

  const publish = (ids: Iterable<string>) => {
    // Every reader observes the complete transaction, including stats and QA metadata.
    for (const id of ids) {
      for (const listener of [...(listenersBySegmentId.get(id) ?? [])]) listener();
    }
    for (const listener of [...listeners]) listener();
  };

  const replaceAll = (segments: readonly Segment[]): void => {
    const previousById = segmentById;
    orderedSegments = [...segments];
    orderIds = orderedSegments.map((segment) => segment.segmentId);
    segmentById = new Map(orderedSegments.map((segment) => [segment.segmentId, segment]));
    indexById = new Map(orderIds.map((id, index) => [id, index]));
    stats = buildSegmentStats(orderedSegments);
    qaRevision += 1;
    qaResults = null;
    qaSegmentIds = new Set(
      orderedSegments.filter((s) => s.qaIssues !== undefined).map((s) => s.segmentId),
    );
    publish(
      [...listenersBySegmentId.keys()].filter((id) => previousById.get(id) !== segmentById.get(id)),
    );
  };

  const applyUpdates = (updates: ReadonlyMap<string, Segment>): EditorSegmentChange[] => {
    const changes: EditorSegmentChange[] = [];
    let contentChanged = false;
    for (const [segmentId, next] of updates) {
      const previous = segmentById.get(segmentId);
      const index = indexById.get(segmentId);
      if (!previous || index === undefined || next.segmentId !== segmentId || previous === next)
        continue;
      contentChanged ||=
        !sameTokens(previous.sourceTokens, next.sourceTokens) ||
        !sameTokens(previous.targetTokens, next.targetTokens);
      if (previous.qaIssues !== undefined && next.qaIssues === undefined) contentChanged = true;
      if (previous.qaIssues !== next.qaIssues || previous.meta?.rowRef !== next.meta?.rowRef)
        qaResults = null;
      orderedSegments[index] = next;
      segmentById.set(segmentId, next);
      if (next.qaIssues !== undefined) qaSegmentIds.add(segmentId);
      else qaSegmentIds.delete(segmentId);
      changes.push({ segmentId, previous, next });
    }
    if (changes.length) {
      if (contentChanged) qaRevision += 1;
      stats = updateSegmentStatsFromChanges(stats, changes);
      publish(changes.map((change) => change.segmentId));
    }
    return changes;
  };

  replaceAll(initialSegments);
  return {
    getSegments: () => orderedSegments,
    getOrderIds: () => orderIds,
    getSegment: (id) => segmentById.get(id),
    getIndexById: () => indexById,
    getStats: () => stats,
    getQARevision: () => qaRevision,
    getQAResults: () => {
      if (!qaResults) {
        const ids = [...qaSegmentIds].sort((a, b) => indexById.get(a)! - indexById.get(b)!);
        qaResults = {
          hasResults: ids.length > 0,
          issues: ids.flatMap((id) => {
            const segment = segmentById.get(id)!;
            return (segment.qaIssues ?? []).map((issue) => ({
              ...issue,
              segmentId: id,
              row: segment.meta?.rowRef ?? segment.orderIndex + 1,
            }));
          }),
        };
      }
      return qaResults;
    },
    invalidateQA: () => {
      qaRevision += 1;
      const changes = applyUpdates(
        new Map(
          [...qaSegmentIds].map((id) => [id, { ...segmentById.get(id)!, qaIssues: undefined }]),
        ),
      );
      if (!changes.length) publish([]);
      return changes;
    },
    applyUpdates,
    updateSegment: (id, updater) => {
      const previous = segmentById.get(id);
      if (!previous) return undefined;
      applyUpdates(new Map([[id, updater(previous)]]));
      return segmentById.get(id);
    },
    replaceAll,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeSegment: (id, listener) => {
      const rowListeners = listenersBySegmentId.get(id) ?? new Set<() => void>();
      rowListeners.add(listener);
      listenersBySegmentId.set(id, rowListeners);
      return () => {
        rowListeners.delete(listener);
        if (!rowListeners.size) listenersBySegmentId.delete(id);
      };
    },
  };
}
