import type { SetStateAction } from 'react';
import type { Segment } from '@cat/core/models';
import type { EditorSegmentChange } from './editorSegmentStore';

export interface SegmentChangeHint {
  revision: number;
  orderChanged: boolean;
  changedSegmentIds: ReadonlySet<string>;
}

export interface SegmentChangeHintInput {
  orderChanged?: boolean;
  changedSegmentIds?: Iterable<string>;
}

export interface SegmentStats {
  totalSegments: number;
  confirmedSegments: number;
}

export type SetSegmentsWithChangeHint = (
  update: SetStateAction<Segment[]>,
  hint?: SegmentChangeHintInput,
) => void;

export function createSegmentIndexById(segments: readonly Segment[]): Map<string, number> {
  const index = new Map<string, number>();
  segments.forEach((segment, position) => {
    index.set(segment.segmentId, position);
  });
  return index;
}

export function createSegmentChangeHint(
  input: SegmentChangeHintInput | undefined,
  revision: number,
): SegmentChangeHint {
  return {
    revision,
    orderChanged: input?.orderChanged ?? true,
    changedSegmentIds: new Set(input?.changedSegmentIds ?? []),
  };
}

export function assertSegmentChangeHintMatchesUpdate(
  previousSegments: readonly Segment[],
  nextSegments: readonly Segment[],
  hint: SegmentChangeHintInput | undefined,
): void {
  if (hint?.orderChanged !== false) return;

  if (previousSegments.length !== nextSegments.length) {
    throw new Error('orderChanged=false requires segment count to stay stable');
  }

  for (let index = 0; index < previousSegments.length; index += 1) {
    if (previousSegments[index]?.segmentId !== nextSegments[index]?.segmentId) {
      throw new Error('orderChanged=false requires segment order to stay stable');
    }
  }
}

export function getIndexedSegment(
  segments: readonly Segment[],
  segmentIndexById: ReadonlyMap<string, number>,
  segmentId: string,
): Segment | undefined {
  const index = segmentIndexById.get(segmentId);
  if (index === undefined) return undefined;
  const segment = segments[index];
  return segment?.segmentId === segmentId ? segment : undefined;
}

export function buildSegmentStats(segments: readonly Segment[]): SegmentStats {
  let confirmedSegments = 0;
  for (const segment of segments) {
    if (segment.status === 'confirmed') {
      confirmedSegments += 1;
    }
  }
  return {
    totalSegments: segments.length,
    confirmedSegments,
  };
}

export function updateSegmentStatsFromChanges(
  previousStats: SegmentStats,
  changes: readonly EditorSegmentChange[],
): SegmentStats {
  let confirmedSegments = previousStats.confirmedSegments;
  for (const change of changes) {
    if (change.previous.status !== 'confirmed' && change.next.status === 'confirmed') {
      confirmedSegments += 1;
    } else if (change.previous.status === 'confirmed' && change.next.status !== 'confirmed') {
      confirmedSegments -= 1;
    }
  }

  if (confirmedSegments === previousStats.confirmedSegments) {
    return previousStats;
  }

  return {
    totalSegments: previousStats.totalSegments,
    confirmedSegments,
  };
}

export function updateSegmentStats(params: {
  previousStats: SegmentStats;
  previousSegments: readonly Segment[];
  nextSegments: readonly Segment[];
  segmentIndexById: ReadonlyMap<string, number>;
  changeHint: SegmentChangeHint;
}): SegmentStats {
  const { previousStats, previousSegments, nextSegments, segmentIndexById, changeHint } = params;

  if (changeHint.orderChanged || previousSegments.length !== nextSegments.length) {
    return buildSegmentStats(nextSegments);
  }

  let confirmedSegments = previousStats.confirmedSegments;
  for (const segmentId of changeHint.changedSegmentIds) {
    const index = segmentIndexById.get(segmentId);
    if (index === undefined || index < 0 || index >= nextSegments.length) {
      return buildSegmentStats(nextSegments);
    }

    const previousSegment = previousSegments[index];
    const nextSegment = nextSegments[index];
    if (previousSegment?.segmentId !== segmentId || nextSegment?.segmentId !== segmentId) {
      return buildSegmentStats(nextSegments);
    }

    if (previousSegment.status !== 'confirmed' && nextSegment.status === 'confirmed') {
      confirmedSegments += 1;
    } else if (previousSegment.status === 'confirmed' && nextSegment.status !== 'confirmed') {
      confirmedSegments -= 1;
    }
  }

  return {
    totalSegments: nextSegments.length,
    confirmedSegments,
  };
}
