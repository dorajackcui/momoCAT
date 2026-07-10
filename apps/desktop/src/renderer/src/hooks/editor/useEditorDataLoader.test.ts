import { describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import {
  applyBatchSegmentUpdatesToStore,
  applyBatchSegmentUpdatesToSegments,
  buildBatchFinalState,
  buildSegmentIndex,
  drainQueuedSegmentsUpdatedEvents,
  handleIncomingSegmentsUpdatedBatch,
  handleIncomingSegmentsUpdatedEvent,
} from './useEditorDataLoader';
import { createEditorSegmentStore } from './editorSegmentStore';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));

function createEvent(segmentId: string, clientRequestId?: string): SegmentsUpdatedEvent {
  return {
    fileId: 1,
    segmentId,
    targetTokens: [{ type: 'text', content: `target-${segmentId}` }],
    status: 'draft',
    propagatedIds: [],
    clientRequestId,
    serverAppliedAt: '2026-02-27T00:00:00.000Z',
  };
}

function createEventForFile(segmentId: string, fileId: number): SegmentsUpdatedEvent {
  return {
    ...createEvent(segmentId),
    fileId,
  };
}

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

function createHandlers(overrides?: {
  activeFileId?: number | null;
  shouldDelay?: (segmentId: string) => boolean;
  isStale?: (segmentId: string) => boolean;
}) {
  return {
    activeFileId: overrides?.activeFileId,
    queuedRemoteUpdates: new Map<string, SegmentsUpdatedEvent>(),
    shouldDelayRemoteUpdate: overrides?.shouldDelay ?? (() => false),
    isRemoteUpdateStale: overrides?.isStale ?? (() => false),
    applySegmentsUpdatedEvent: vi.fn(),
    applySegmentsUpdatedBatch: vi.fn(),
  };
}

describe('handleIncomingSegmentsUpdatedEvent', () => {
  it('applies incoming remote update immediately when not stale and not delayed', () => {
    const handlers = createHandlers();
    const event = createEvent('seg-1', 'req-1');

    const result = handleIncomingSegmentsUpdatedEvent(event, handlers);

    expect(result).toBe('applied');
    expect(handlers.applySegmentsUpdatedEvent).toHaveBeenCalledWith(event);
    expect(handlers.queuedRemoteUpdates.size).toBe(0);
  });

  it('queues incoming remote update when delay gate is active', () => {
    const handlers = createHandlers({ shouldDelay: () => true });
    const event = createEvent('seg-2', 'req-2');

    const result = handleIncomingSegmentsUpdatedEvent(event, handlers);

    expect(result).toBe('queued');
    expect(handlers.applySegmentsUpdatedEvent).not.toHaveBeenCalled();
    expect(handlers.queuedRemoteUpdates.get('seg-2')).toEqual(event);
  });

  it('drops stale incoming remote update', () => {
    const handlers = createHandlers({ isStale: () => true });
    const event = createEvent('seg-3', 'req-3');

    const result = handleIncomingSegmentsUpdatedEvent(event, handlers);

    expect(result).toBe('stale');
    expect(handlers.applySegmentsUpdatedEvent).not.toHaveBeenCalled();
    expect(handlers.queuedRemoteUpdates.size).toBe(0);
  });

  it('ignores incoming remote update for a different file', () => {
    const handlers = createHandlers({ activeFileId: 10 });
    const event = createEventForFile('seg-other-file', 20);

    const result = handleIncomingSegmentsUpdatedEvent(event, handlers);

    expect(result).toBe('ignored');
    expect(handlers.applySegmentsUpdatedEvent).not.toHaveBeenCalled();
    expect(handlers.queuedRemoteUpdates.size).toBe(0);
  });
});

describe('handleIncomingSegmentsUpdatedBatch', () => {
  it('applies all events via batch applier in a single call', () => {
    const handlers = createHandlers();
    const events = [createEvent('seg-1'), createEvent('seg-2'), createEvent('seg-3')];

    const result = handleIncomingSegmentsUpdatedBatch(events, handlers);

    expect(result).toEqual({ applied: 3, queued: 0, stale: 0 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledTimes(1);
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith(events);
    expect(handlers.applySegmentsUpdatedEvent).not.toHaveBeenCalled();
  });

  it('classifies stale, queued, and applicable events within a batch', () => {
    const handlers = createHandlers({
      shouldDelay: (id) => id === 'seg-delay',
      isStale: (id) => id === 'seg-stale',
    });
    const events = [
      createEvent('seg-apply', 'req-apply'),
      createEvent('seg-delay', 'req-delay'),
      createEvent('seg-stale', 'req-stale'),
    ];

    const result = handleIncomingSegmentsUpdatedBatch(events, handlers);

    expect(result).toEqual({ applied: 1, queued: 1, stale: 1 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith([events[0]]);
    expect(handlers.queuedRemoteUpdates.get('seg-delay')).toEqual(events[1]);
    expect(handlers.queuedRemoteUpdates.has('seg-stale')).toBe(false);
  });

  it('does not call batch applier when all events are filtered out', () => {
    const handlers = createHandlers({ isStale: () => true });

    const result = handleIncomingSegmentsUpdatedBatch(
      [createEvent('seg-1'), createEvent('seg-2')],
      handlers,
    );

    expect(result).toEqual({ applied: 0, queued: 0, stale: 2 });
    expect(handlers.applySegmentsUpdatedBatch).not.toHaveBeenCalled();
  });

  it('handles an empty batch as a no-op', () => {
    const handlers = createHandlers();

    const result = handleIncomingSegmentsUpdatedBatch([], handlers);

    expect(result).toEqual({ applied: 0, queued: 0, stale: 0 });
    expect(handlers.applySegmentsUpdatedBatch).not.toHaveBeenCalled();
  });

  it('handles a batch of one the same as a single event through batch path', () => {
    const handlers = createHandlers();
    const event = createEvent('seg-solo', 'req-solo');

    const result = handleIncomingSegmentsUpdatedBatch([event], handlers);

    expect(result).toEqual({ applied: 1, queued: 0, stale: 0 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith([event]);
  });

  it('filters out events for other files before applying a batch', () => {
    const handlers = createHandlers({ activeFileId: 10 });
    const currentFileEvent = createEventForFile('seg-current-file', 10);
    const otherFileEvent = createEventForFile('seg-other-file', 20);

    const result = handleIncomingSegmentsUpdatedBatch([otherFileEvent, currentFileEvent], handlers);

    expect(result).toEqual({ applied: 1, queued: 0, stale: 0 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledTimes(1);
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith([currentFileEvent]);
    expect(handlers.queuedRemoteUpdates.size).toBe(0);
  });
});

describe('drainQueuedSegmentsUpdatedEvents', () => {
  it('drains queued updates via batch applier and keeps delayed ones queued', () => {
    const handlers = createHandlers({
      shouldDelay: (id) => id === 'seg-delay',
      isStale: (id) => id === 'seg-stale',
    });
    handlers.queuedRemoteUpdates.set('seg-open', createEvent('seg-open', 'req-open'));
    handlers.queuedRemoteUpdates.set('seg-delay', createEvent('seg-delay', 'req-delay'));
    handlers.queuedRemoteUpdates.set('seg-stale', createEvent('seg-stale', 'req-stale'));

    const result = drainQueuedSegmentsUpdatedEvents(handlers);

    expect(result).toEqual({ appliedCount: 1, droppedStaleCount: 1 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledTimes(1);
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith([
      createEvent('seg-open', 'req-open'),
    ]);
    expect(handlers.queuedRemoteUpdates.has('seg-open')).toBe(false);
    expect(handlers.queuedRemoteUpdates.has('seg-stale')).toBe(false);
    expect(handlers.queuedRemoteUpdates.has('seg-delay')).toBe(true);
  });

  it('drops queued updates for files that are no longer active', () => {
    const handlers = createHandlers({ activeFileId: 10 });
    const currentFileEvent = createEventForFile('seg-current', 10);
    const oldFileEvent = createEventForFile('seg-old', 11);
    handlers.queuedRemoteUpdates.set(currentFileEvent.segmentId, currentFileEvent);
    handlers.queuedRemoteUpdates.set(oldFileEvent.segmentId, oldFileEvent);

    const result = drainQueuedSegmentsUpdatedEvents(handlers);

    expect(result).toEqual({ appliedCount: 1, droppedStaleCount: 0 });
    expect(handlers.applySegmentsUpdatedBatch).toHaveBeenCalledWith([currentFileEvent]);
    expect(handlers.queuedRemoteUpdates.has(currentFileEvent.segmentId)).toBe(false);
    expect(handlers.queuedRemoteUpdates.has(oldFileEvent.segmentId)).toBe(false);
  });

  it('does not call batch applier when no events are applicable', () => {
    const handlers = createHandlers({ shouldDelay: () => true });
    handlers.queuedRemoteUpdates.set('seg-1', createEvent('seg-1'));

    const result = drainQueuedSegmentsUpdatedEvents(handlers);

    expect(result).toEqual({ appliedCount: 0, droppedStaleCount: 0 });
    expect(handlers.applySegmentsUpdatedBatch).not.toHaveBeenCalled();
    expect(handlers.queuedRemoteUpdates.has('seg-1')).toBe(true);
  });
});

describe('applyBatchSegmentUpdatesToSegments', () => {
  const normalizeTokens = (tokens: unknown): Token[] =>
    Array.isArray(tokens) ? (tokens as Token[]) : [];
  const normalizeStatus = (status: unknown, targetTokens: Token[]): SegmentStatus =>
    typeof status === 'string' && targetTokens.length > 0 ? (status as SegmentStatus) : 'new';

  it('updates only indexed direct and propagated segments while preserving untouched references', () => {
    const first = createSegment('seg-1');
    const second = createSegment('seg-2');
    const third = createSegment('seg-3');
    const segments = [first, second, third];
    const batch = [
      {
        ...createEvent('seg-1'),
        targetTokens: [{ type: 'text', content: 'direct target' }],
        status: 'translated' as SegmentStatus,
      },
      {
        ...createEvent('seg-3'),
        targetTokens: [{ type: 'text', content: 'propagated target' }],
        status: 'confirmed' as SegmentStatus,
        propagatedIds: ['seg-2'],
      },
    ];

    const result = applyBatchSegmentUpdatesToSegments({
      segments,
      segmentIndex: buildSegmentIndex(segments),
      finalState: buildBatchFinalState(batch),
      normalizeTokens,
      normalizeStatus,
      directContext: 'batch-update',
      propagationContext: 'batch-propagation',
    });

    expect(result).not.toBe(segments);
    expect(result[0]).toMatchObject({
      segmentId: 'seg-1',
      targetTokens: [{ type: 'text', content: 'direct target' }],
      status: 'translated',
    });
    expect(result[1]).toMatchObject({
      segmentId: 'seg-2',
      targetTokens: [{ type: 'text', content: 'propagated target' }],
      status: 'draft',
    });
    expect(result[2]).toMatchObject({
      segmentId: 'seg-3',
      targetTokens: [{ type: 'text', content: 'propagated target' }],
      status: 'confirmed',
    });
    expect(first.targetTokens).toEqual([]);
    expect(second.targetTokens).toEqual([]);
  });

  it('returns the original array when indexed batch entries do not match any segment', () => {
    const segments = [createSegment('seg-1'), createSegment('seg-2')];
    const normalizeSpy = vi.fn(normalizeTokens);

    const result = applyBatchSegmentUpdatesToSegments({
      segments,
      segmentIndex: buildSegmentIndex(segments),
      finalState: buildBatchFinalState([createEvent('seg-missing')]),
      normalizeTokens: normalizeSpy,
      normalizeStatus,
      directContext: 'batch-update',
      propagationContext: 'batch-propagation',
    });

    expect(result).toBe(segments);
    expect(normalizeSpy).not.toHaveBeenCalled();
  });

  it('does not read untouched segment ids when the index is current', () => {
    const target = createSegment('seg-target');
    const poison = createSegment('seg-poison');
    Object.defineProperty(poison, 'segmentId', {
      get() {
        throw new Error('untouched segment was scanned');
      },
    });
    const segments = [target, poison];
    const segmentIndex = new Map<string, number>([['seg-target', 0]]);

    const result = applyBatchSegmentUpdatesToSegments({
      segments,
      segmentIndex,
      finalState: buildBatchFinalState([createEvent('seg-target')]),
      normalizeTokens,
      normalizeStatus,
      directContext: 'batch-update',
      propagationContext: 'batch-propagation',
    });

    expect(result[0]).toMatchObject({
      segmentId: 'seg-target',
      targetTokens: [{ type: 'text', content: 'target-seg-target' }],
    });
    expect(result[1]).toBe(poison);
  });
});

describe('applyBatchSegmentUpdatesToStore', () => {
  const normalizeTokens = (tokens: unknown): Token[] =>
    Array.isArray(tokens) ? (tokens as Token[]) : [];
  const normalizeStatus = (status: unknown, targetTokens: Token[]): SegmentStatus =>
    typeof status === 'string' && targetTokens.length > 0 ? (status as SegmentStatus) : 'new';

  it('patches only changed ids while preserving the ordered segment array', () => {
    const first = createSegment('seg-1');
    const second = createSegment('seg-2');
    const third = createSegment('seg-3');
    const store = createEditorSegmentStore([first, second, third]);
    const orderedBefore = store.getSegments();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribeSegment('seg-1', firstListener);
    store.subscribeSegment('seg-2', secondListener);

    const changes = applyBatchSegmentUpdatesToStore({
      store,
      finalState: buildBatchFinalState([
        {
          ...createEvent('seg-2'),
          targetTokens: [{ type: 'text', content: 'translated target' }],
          status: 'translated',
        },
      ]),
      normalizeTokens,
      normalizeStatus,
      directContext: 'store-batch-update',
      propagationContext: 'store-batch-propagation',
    });

    expect(store.getSegments()).toBe(orderedBefore);
    expect(store.getSegment('seg-1')).toBe(first);
    expect(store.getSegment('seg-3')).toBe(third);
    expect(store.getSegment('seg-2')).toMatchObject({
      targetTokens: [{ type: 'text', content: 'translated target' }],
      status: 'translated',
    });
    expect(changes.map((change) => change.segmentId)).toEqual(['seg-2']);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
  });
});

describe('buildBatchFinalState', () => {
  it('later propagation overrides earlier direct update for the same segment', () => {
    const directEvent: SegmentsUpdatedEvent = {
      fileId: 1,
      segmentId: 'seg-B',
      targetTokens: [{ type: 'text', content: 'direct-draft' }],
      status: 'draft',
      propagatedIds: [],
      serverAppliedAt: '2026-06-30T00:00:00.000Z',
    };
    const confirmEvent: SegmentsUpdatedEvent = {
      fileId: 1,
      segmentId: 'seg-A',
      targetTokens: [{ type: 'text', content: 'confirmed-translation' }],
      status: 'confirmed',
      propagatedIds: ['seg-B'],
      serverAppliedAt: '2026-06-30T00:00:01.000Z',
    };

    const state = buildBatchFinalState([directEvent, confirmEvent]);

    expect(state.get('seg-A')).toEqual({ type: 'direct', event: confirmEvent });
    expect(state.get('seg-B')).toEqual({ type: 'propagation', event: confirmEvent });
  });

  it('later direct update overrides earlier propagation for the same segment', () => {
    const confirmEvent: SegmentsUpdatedEvent = {
      fileId: 1,
      segmentId: 'seg-A',
      targetTokens: [{ type: 'text', content: 'confirmed' }],
      status: 'confirmed',
      propagatedIds: ['seg-B'],
      serverAppliedAt: '2026-06-30T00:00:00.000Z',
    };
    const laterDirect: SegmentsUpdatedEvent = {
      fileId: 1,
      segmentId: 'seg-B',
      targetTokens: [{ type: 'text', content: 'later-edit' }],
      status: 'draft',
      propagatedIds: [],
      serverAppliedAt: '2026-06-30T00:00:02.000Z',
    };

    const state = buildBatchFinalState([confirmEvent, laterDirect]);

    expect(state.get('seg-A')).toEqual({ type: 'direct', event: confirmEvent });
    expect(state.get('seg-B')).toEqual({ type: 'direct', event: laterDirect });
  });

  it('handles a single event without conflicts', () => {
    const event = createEvent('seg-1', 'req-1');

    const state = buildBatchFinalState([event]);

    expect(state.size).toBe(1);
    expect(state.get('seg-1')).toEqual({ type: 'direct', event });
  });
});
