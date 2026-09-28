import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import { updateSegmentStatsFromChanges } from './editorSegmentState';

function createSegment(segmentId: string, status: Segment['status']): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'source' }],
    targetTokens: [],
    status,
    tagsSignature: '',
    matchKey: segmentId,
    srcHash: segmentId,
    meta: {},
  };
}

describe('editorSegmentState stats', () => {
  it('updates counts from concrete store changes without scanning untouched segments', () => {
    const first = createSegment('s1', 'empty');
    const nextFirst = { ...first, status: 'confirmed' as const };
    const second = createSegment('s2', 'confirmed');
    const nextSecond = { ...second, status: 'draft' as const };

    const nextStats = updateSegmentStatsFromChanges(
      { totalSegments: 20_000, confirmedSegments: 9_000 },
      [
        { segmentId: first.segmentId, previous: first, next: nextFirst },
        { segmentId: second.segmentId, previous: second, next: nextSecond },
      ],
    );

    expect(nextStats).toEqual({ totalSegments: 20_000, confirmedSegments: 9_000 });
  });
});
