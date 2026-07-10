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
    status: target ? 'draft' : 'new',
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
            status: 'translated' as const,
          },
        ],
      ]),
    );

    expect(store.getSegments()).toBe(orderedBefore);
    expect(store.getSegment('seg-1')).toBe(first);
    expect(store.getSegment('seg-2')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'translated' }],
      status: 'translated',
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
