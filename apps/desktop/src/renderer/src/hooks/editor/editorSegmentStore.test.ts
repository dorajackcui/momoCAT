import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createEditorSegmentStore } from './editorSegmentStore';

function createSegment(segmentId: string, target = ''): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: Number(segmentId.replace(/\D/g, '')) || 0,
    sourceTokens: [{ type: 'text', content: `source-${segmentId}` }],
    targetTokens: target ? [{ type: 'text', content: target }] : [],
    status: target ? 'draft' : 'empty',
    tagsSignature: '',
    matchKey: `source-${segmentId}`,
    srcHash: `hash-${segmentId}`,
    meta: {},
  };
}

describe('editorSegmentStore', () => {
  it('updates same-order segments without replacing the ordered array', () => {
    const first = createSegment('seg-1');
    const second = createSegment('seg-2');
    const store = createEditorSegmentStore([first, second]);
    const orderedBefore = store.getSegments();

    const changes = store.applyUpdates(
      new Map([
        [
          'seg-2',
          {
            ...second,
            targetTokens: [{ type: 'text' as const, content: 'translated' }],
            status: 'draft' as const,
          },
        ],
      ]),
    );

    expect(store.getSegments()).toBe(orderedBefore);
    expect(store.getSegment('seg-1')).toBe(first);
    expect(store.getSegment('seg-2')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'translated' }],
      status: 'draft',
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ segmentId: 'seg-2', previous: second });
  });

  it('notifies only subscribers for changed segment ids', () => {
    const first = createSegment('seg-1');
    const second = createSegment('seg-2');
    const store = createEditorSegmentStore([first, second]);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribeSegment('seg-1', firstListener);
    store.subscribeSegment('seg-2', secondListener);

    store.applyUpdates(
      new Map([
        [
          'seg-2',
          {
            ...second,
            targetTokens: [{ type: 'text' as const, content: 'translated' }],
          },
        ],
      ]),
    );

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it('rebuilds order only when the full segment list is replaced', () => {
    const store = createEditorSegmentStore([createSegment('seg-1'), createSegment('seg-2')]);
    const orderedBefore = store.getSegments();

    store.replaceAll([createSegment('seg-2'), createSegment('seg-1')]);

    expect(store.getSegments()).not.toBe(orderedBefore);
    expect(store.getOrderIds()).toEqual(['seg-2', 'seg-1']);
    expect(store.getIndexById().get('seg-1')).toBe(1);
  });
});

it('publishes every transaction with complete stats, even before React renders', () => {
  const store = createEditorSegmentStore([createSegment('a'), createSegment('b')]);
  const statuses: number[] = [];
  store.subscribe(() => statuses.push(store.getStats().confirmedSegments));
  store.updateSegment('a', (row) => ({ ...row, status: 'confirmed' }));
  store.updateSegment('b', (row) => ({ ...row, status: 'confirmed' }));
  expect(statuses).toEqual([1, 2]);
});

it('keeps order, stats and QA results stable during an ordinary target edit', () => {
  const store = createEditorSegmentStore([
    {
      ...createSegment('a', 'old'),
      qaIssues: [{ ruleId: 'number', severity: 'info', message: 'finding' }],
    },
  ]);
  const order = store.getOrderIds(),
    stats = store.getStats(),
    qa = store.getQAResults();
  const validity = store.getQARevision();
  store.updateSegment('a', (row) => ({ ...row, targetTokens: [{ type: 'text', content: 'new' }] }));
  expect(store.getOrderIds()).toBe(order);
  expect(store.getStats()).toBe(stats);
  expect(store.getQAResults()).toBe(qa);
  expect(store.getQARevision()).toBeGreaterThan(validity);
  store.updateSegment('a', (row) => ({ ...row, qaIssues: [] }));
  expect(store.getQAResults()).not.toBe(qa);
  expect(store.getQAResults()).toEqual({ hasResults: true, issues: [] });
});
