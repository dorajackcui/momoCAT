import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import {
  buildEditorFilterStorageKey,
  buildSearchableEditorSegments,
  buildSearchableEditorSegmentsWithWeakCache,
  resolveActiveSegmentIdForFilteredList,
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
