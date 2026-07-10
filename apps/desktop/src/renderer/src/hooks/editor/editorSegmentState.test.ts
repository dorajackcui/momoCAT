import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import {
  assertSegmentChangeHintMatchesUpdate,
  buildSegmentStats,
  createSegmentChangeHint,
  createSegmentIndexById,
  updateSegmentStatsFromChanges,
  updateSegmentStats,
} from './editorSegmentState';

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
    const first = createSegment('s1', 'new');
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

  it('updates counts from changed ids without reading untouched segments', () => {
    const first = createSegment('s1', 'new');
    const second = createSegment('s2', 'confirmed');
    const previous = [first, second];
    const nextFirst = { ...first, status: 'confirmed' as const };
    const poisonSecond = { ...second };
    Object.defineProperty(poisonSecond, 'status', {
      get() {
        throw new Error('untouched segment status was read');
      },
    });

    const nextStats = updateSegmentStats({
      previousStats: buildSegmentStats(previous),
      previousSegments: previous,
      nextSegments: [nextFirst, poisonSecond],
      segmentIndexById: createSegmentIndexById(previous),
      changeHint: createSegmentChangeHint({ orderChanged: false, changedSegmentIds: ['s1'] }, 1),
    });

    expect(nextStats).toEqual({ totalSegments: 2, confirmedSegments: 2 });
  });
});

describe('editorSegmentState change hints', () => {
  it('allows order-stable hints when length and segment id order are unchanged', () => {
    const previous = [createSegment('s1', 'new'), createSegment('s2', 'draft')];
    const next = [{ ...previous[0], status: 'translated' as const }, previous[1]];

    expect(() =>
      assertSegmentChangeHintMatchesUpdate(previous, next, {
        orderChanged: false,
        changedSegmentIds: ['s1'],
      }),
    ).not.toThrow();
  });

  it('rejects order-stable hints when the segment count changes', () => {
    const previous = [createSegment('s1', 'new')];
    const next = [...previous, createSegment('s2', 'draft')];

    expect(() =>
      assertSegmentChangeHintMatchesUpdate(previous, next, {
        orderChanged: false,
        changedSegmentIds: ['s2'],
      }),
    ).toThrow('orderChanged=false requires segment count to stay stable');
  });

  it('rejects order-stable hints when segment order changes', () => {
    const first = createSegment('s1', 'new');
    const second = createSegment('s2', 'draft');

    expect(() =>
      assertSegmentChangeHintMatchesUpdate([first, second], [second, first], {
        orderChanged: false,
        changedSegmentIds: ['s1', 's2'],
      }),
    ).toThrow('orderChanged=false requires segment order to stay stable');
  });
});
