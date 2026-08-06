import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createDefaultEditorFilterCriteria } from '../components/editorFilterUtils';
import {
  buildEditorFilterStorageKey,
  buildSearchableEditorSegments,
  buildSearchableEditorSegmentsIncrementally,
  buildSearchableEditorSegmentsWithWeakCache,
  canReuseEditorSegmentListWithoutRefreshingSearchText,
  createEditorFilterSnapshotCache,
  createEditorSearchableListCache,
  resolveActiveSegmentIdForFilteredList,
  resolveActiveFilteredSegmentIndex,
  sanitizePersistedEditorFilterState,
} from './useEditorFilters';

function createSegment(params: {
  id: string;
  status?: Segment['status'];
  source?: string;
  target?: string;
  qaSeverities?: Array<'error' | 'warning' | 'info'>;
}): Segment {
  return {
    segmentId: params.id,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: params.source ?? 'source' }],
    targetTokens: params.target ? [{ type: 'text', content: params.target }] : [],
    status: params.status ?? 'new',
    tagsSignature: '',
    matchKey: params.id,
    srcHash: params.id,
    meta: {
      updatedAt: new Date().toISOString(),
    },
    qaIssues: (params.qaSeverities ?? []).map((severity, index) => ({
      ruleId: `rule-${index}`,
      severity,
      message: `issue-${index}`,
    })),
  };
}

describe('useEditorFilters helpers', () => {
  it('keeps filtered membership stable until the filter criteria changes', () => {
    const cache = createEditorFilterSnapshotCache();
    const criteria = {
      ...createDefaultEditorFilterCriteria(),
      targetQuery: 'apple',
    };
    const initial = buildSearchableEditorSegments(
      [
        createSegment({ id: 's1', target: 'apple' }),
        createSegment({ id: 's2', target: 'green apple' }),
        createSegment({ id: 's3', target: 'pear' }),
      ],
      {},
    );

    const firstResult = cache.resolve({ scopeKey: 1, segments: initial, criteria });

    expect(firstResult.map((item) => item.segment.segmentId)).toEqual(['s1', 's2']);

    const edited = buildSearchableEditorSegments(
      [
        createSegment({ id: 's1', target: 'pomme' }),
        createSegment({ id: 's2', target: 'green apple' }),
        createSegment({ id: 's3', target: 'apple' }),
      ],
      {},
    );
    const stableResult = cache.resolve({ scopeKey: 1, segments: edited, criteria });

    expect(stableResult.map((item) => item.segment.segmentId)).toEqual(['s1', 's2']);
    expect(stableResult[0].targetText).toBe('pomme');

    const refreshedResult = cache.resolve({
      scopeKey: 1,
      segments: edited,
      criteria: { ...criteria, targetQuery: 'pomme' },
    });

    expect(refreshedResult.map((item) => item.segment.segmentId)).toEqual(['s1']);
  });

  it('refreshes a filter snapshot when the segment list is structurally reloaded', () => {
    const cache = createEditorFilterSnapshotCache();
    const criteria = {
      ...createDefaultEditorFilterCriteria(),
      targetQuery: 'apple',
    };

    expect(cache.resolve({ scopeKey: 1, segments: [], criteria })).toEqual([]);

    const firstLoad = buildSearchableEditorSegments(
      [createSegment({ id: 's1', target: 'apple' })],
      {},
    );
    expect(
      cache
        .resolve({ scopeKey: 1, segments: firstLoad, criteria, refreshToken: 1 })
        .map((item) => item.segment.segmentId),
    ).toEqual(['s1']);

    const editedList = buildSearchableEditorSegments(
      [createSegment({ id: 's1', target: 'apple' }), createSegment({ id: 's2', target: 'apple' })],
      {},
    );
    expect(
      cache
        .resolve({ scopeKey: 1, segments: editedList, criteria, refreshToken: 1 })
        .map((item) => item.segment.segmentId),
    ).toEqual(['s1']);
    expect(
      cache
        .resolve({ scopeKey: 1, segments: editedList, criteria, refreshToken: 2 })
        .map((item) => item.segment.segmentId),
    ).toEqual(['s1', 's2']);
  });

  it('reuses stale search text only when list membership and order ignore segment content', () => {
    const defaults = createDefaultEditorFilterCriteria();

    expect(canReuseEditorSegmentListWithoutRefreshingSearchText(defaults)).toBe(true);
    expect(
      canReuseEditorSegmentListWithoutRefreshingSearchText({
        ...defaults,
        targetQuery: 'translated',
      }),
    ).toBe(false);
    expect(
      canReuseEditorSegmentListWithoutRefreshingSearchText({
        ...defaults,
        status: 'confirmed',
      }),
    ).toBe(false);
    expect(
      canReuseEditorSegmentListWithoutRefreshingSearchText({
        ...defaults,
        sortBy: 'target_length',
      }),
    ).toBe(false);
  });

  it('defers searchable text work on the default list and catches up when a filter activates', () => {
    const first = createSegment({ id: 's1', target: 'before' });
    const second = createSegment({ id: 's2', target: 'untouched' });
    const segments = [first, second];
    const cache = createEditorSearchableListCache();
    const initial = cache.resolve({
      segments,
      segmentSaveErrors: {},
      orderChanged: true,
      contentIndependent: true,
      segmentIndexById: new Map([
        ['s1', 0],
        ['s2', 1],
      ]),
    });

    segments[0] = {
      ...first,
      targetTokens: [{ type: 'text', content: 'after' }],
    };
    const defaultList = cache.resolve({
      segments,
      segmentSaveErrors: {},
      orderChanged: false,
      changedSegmentIds: new Set(['s1']),
      contentIndependent: true,
      segmentIndexById: new Map([
        ['s1', 0],
        ['s2', 1],
      ]),
    });
    const filteredList = cache.resolve({
      segments,
      segmentSaveErrors: {},
      orderChanged: false,
      changedSegmentIds: new Set(['s1']),
      contentIndependent: false,
      segmentIndexById: new Map([
        ['s1', 0],
        ['s2', 1],
      ]),
    });

    expect(defaultList).toBe(initial);
    expect(filteredList).not.toBe(initial);
    expect(filteredList[0].targetText).toBe('after');
  });

  it('builds stable storage key', () => {
    expect(buildEditorFilterStorageKey(12)).toBe('editor-filter-state:v1:file:12');
  });

  it('sanitizes persisted state and falls back on invalid values', () => {
    const sanitized = sanitizePersistedEditorFilterState({
      sourceQuery: 'abc',
      targetQuery: 123,
      status: 'draft',
      matchMode: 'regex',
      qualityFilters: ['qa_error', 'invalid'],
      quickPreset: 'issues',
      sortBy: 'target_length',
      sortDirection: 'desc',
    });

    expect(sanitized).toEqual({
      sourceQuery: 'abc',
      targetQuery: '',
      status: 'draft',
      matchMode: 'regex',
      qualityFilters: ['qa_error'],
      quickPreset: 'issues',
      sortBy: 'target_length',
      sortDirection: 'desc',
    });
  });

  it('builds searchable segment flags from segment and save errors', () => {
    const segments: Segment[] = [
      createSegment({
        id: 's1',
        status: 'new',
        source: 'Hello',
        target: '',
        qaSeverities: [],
      }),
      createSegment({
        id: 's2',
        status: 'draft',
        source: 'World',
        target: '世界',
        qaSeverities: ['error', 'warning'],
      }),
    ];

    const searchable = buildSearchableEditorSegments(segments, { s2: 'save failed' });

    expect(searchable).toHaveLength(2);
    expect(searchable[0]).toMatchObject({
      sourceText: 'Hello',
      targetText: '',
      isUntranslated: true,
      hasIssue: false,
    });
    expect(searchable[1]).toMatchObject({
      sourceText: 'World',
      targetText: '世界',
      hasQaError: true,
      hasQaWarning: true,
      hasSaveError: true,
      hasIssue: true,
    });
  });

  it('marks only later occurrences of the same source hash as repeated', () => {
    const first = createSegment({ id: 's1', source: 'Repeat', target: '' });
    const second = createSegment({ id: 's2', source: 'Repeat', target: '' });
    const unique = createSegment({ id: 's3', source: 'Unique', target: '' });
    second.srcHash = first.srcHash;

    const searchable = buildSearchableEditorSegments([first, unique, second], {});

    expect(searchable.map((item) => item.isRepeatedSource)).toEqual([false, false, true]);
  });

  it('reuses cached searchable items for unchanged segment objects', () => {
    const segments: Segment[] = [
      createSegment({ id: 's1', source: 'Alpha', target: 'A' }),
      createSegment({ id: 's2', source: 'Beta', target: 'B' }),
    ];
    const cache = new WeakMap<Segment, ReturnType<typeof buildSearchableEditorSegments>[number]>();

    const first = buildSearchableEditorSegmentsWithWeakCache({
      segments,
      segmentSaveErrors: {},
      cache,
    });
    const second = buildSearchableEditorSegmentsWithWeakCache({
      segments,
      segmentSaveErrors: {},
      cache,
    });
    const third = buildSearchableEditorSegmentsWithWeakCache({
      segments,
      segmentSaveErrors: { s2: 'save failed' },
      cache,
    });

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(third[0]).toBe(first[0]);
    expect(third[1]).not.toBe(first[1]);
    expect(third[1].hasSaveError).toBe(true);
  });

  it('rebuilds only changed searchable items when order is stable and changed ids are known', () => {
    const first = createSegment({ id: 's1', source: 'Alpha', target: 'A' });
    const second = createSegment({ id: 's2', source: 'Beta', target: 'B' });
    const cache = new WeakMap<Segment, ReturnType<typeof buildSearchableEditorSegments>[number]>();
    const initial = buildSearchableEditorSegmentsWithWeakCache({
      segments: [first, second],
      segmentSaveErrors: {},
      cache,
    });
    const updatedFirst = {
      ...first,
      targetTokens: [{ type: 'text' as const, content: 'AA' }],
    };
    const poisonSecond = { ...second };
    Object.defineProperty(poisonSecond, 'targetTokens', {
      get() {
        throw new Error('untouched segment target tokens were read');
      },
    });

    const next = buildSearchableEditorSegmentsIncrementally({
      segments: [updatedFirst, poisonSecond],
      segmentSaveErrors: {},
      cache,
      previous: initial,
      changedSegmentIds: new Set(['s1']),
      segmentIndexById: new Map([
        ['s1', 0],
        ['s2', 1],
      ]),
      orderChanged: false,
    });

    expect(next).not.toBe(initial);
    expect(next[0]).not.toBe(initial[0]);
    expect(next[0].targetText).toBe('AA');
    expect(next[1]).toBe(initial[1]);
  });

  it('keeps active segment when it still exists but is filtered out', () => {
    const segments: Segment[] = [
      createSegment({ id: 's1', source: 'Alpha' }),
      createSegment({ id: 's2', source: 'Beta' }),
    ];
    const filteredSegments = buildSearchableEditorSegments([segments[0]], {});

    const next = resolveActiveSegmentIdForFilteredList({
      activeSegmentId: 's2',
      segments,
      filteredSegments,
    });

    expect(next).toBe('s2');
  });

  it('uses the segment index to keep active segment existence checks local', () => {
    const first = createSegment({ id: 's1', source: 'Alpha' });
    const second = createSegment({ id: 's2', source: 'Beta' });
    Object.defineProperty(first, 'segmentId', {
      get() {
        throw new Error('untouched segment id was scanned');
      },
    });
    const filteredSegments = buildSearchableEditorSegments([second], {});

    const next = resolveActiveSegmentIdForFilteredList({
      activeSegmentId: 's2',
      segments: [first, second],
      filteredSegments,
      segmentIndexById: new Map([['s2', 1]]),
    });

    expect(next).toBe('s2');
  });

  it('resolves active filtered index from the segment index on the default list path', () => {
    const first = createSegment({ id: 's1', source: 'Alpha' });
    const second = createSegment({ id: 's2', source: 'Beta' });
    Object.defineProperty(first, 'segmentId', {
      get() {
        throw new Error('untouched filtered item id was scanned');
      },
    });
    const filteredSegments = [
      {
        segment: first,
        originalIndex: 0,
        sourceText: 'Alpha',
        targetText: '',
        hasQaError: false,
        hasQaWarning: false,
        hasSaveError: false,
        isUntranslated: true,
        hasIssue: false,
      },
      {
        segment: second,
        originalIndex: 1,
        sourceText: 'Beta',
        targetText: '',
        hasQaError: false,
        hasQaWarning: false,
        hasSaveError: false,
        isUntranslated: true,
        hasIssue: false,
      },
    ];

    const activeIndex = resolveActiveFilteredSegmentIndex({
      activeSegmentId: 's2',
      filteredSegments,
      segmentIndexById: new Map([['s2', 1]]),
      canUseSegmentIndex: true,
    });

    expect(activeIndex).toBe(1);
  });

  it('falls back to first filtered segment when active segment no longer exists', () => {
    const segments: Segment[] = [createSegment({ id: 's1', source: 'Alpha' })];
    const filteredSegments = buildSearchableEditorSegments(segments, {});

    const next = resolveActiveSegmentIdForFilteredList({
      activeSegmentId: 'removed',
      segments,
      filteredSegments,
    });

    expect(next).toBe('s1');
  });
});
