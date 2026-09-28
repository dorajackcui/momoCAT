import type { Segment } from '@cat/core/models';
import type { EditorSegmentChange } from './editorSegmentStore';

export interface SegmentStats {
  totalSegments: number;
  confirmedSegments: number;
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
