import {
  buildSearchableEditorSegments,
  buildSearchableEditorSegmentsWithWeakCache,
} from './editor/editorSearchableSegments';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createDefaultEditorFilterCriteria } from '../components/editorFilterUtils';
import {
  buildEditorFilterStorageKey,
  sanitizePersistedEditorFilterState,
  FILTER_STATUS_OPTIONS,
} from './useEditorFilters';

function createSegment(params: {
  id: string;
  status?: Segment['status'];
  source?: string;
  target?: string;
  context?: string;
  qaSeverities?: Array<'error' | 'warning' | 'info'>;
}): Segment {
  return {
    segmentId: params.id,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: params.source ?? 'source' }],
    targetTokens: params.target ? [{ type: 'text', content: params.target }] : [],
    status: params.status ?? 'empty',
    tagsSignature: '',
    matchKey: params.id,
    srcHash: params.id,
    meta: {
      context: params.context,
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
  it('offers only the three workflow statuses', () => {
    expect(FILTER_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      'all',
      'empty',
      'draft',
      'confirmed',
    ]);
  });

  it.each([
    ['new', 'empty'],
    ['translated', 'draft'],
    ['reviewed', 'draft'],
    ['empty', 'empty'],
    ['draft', 'draft'],
    ['confirmed', 'confirmed'],
  ])('restores the %s status filter as %s', (stored, expected) => {
    expect(
      sanitizePersistedEditorFilterState({ status: stored, sourceQuery: 'window' }),
    ).toMatchObject({ statuses: [expected], sourceQuery: 'window' });
  });

  it('builds stable storage key', () => {
    expect(buildEditorFilterStorageKey(12)).toBe('editor-filter-state:v1:file:12');
  });

  it('sanitizes persisted state and falls back on invalid values', () => {
    const sanitized = sanitizePersistedEditorFilterState({
      sourceQuery: 'abc',
      targetQuery: 123,
      targetSearchScope: 'context',
      status: 'draft',
      matchMode: 'regex',
      qualityFilters: ['qa_error', 'invalid'],
      sortBy: 'target_length',
      sortDirection: 'desc',
    });

    expect(sanitized).toEqual({
      sourceQuery: 'abc',
      targetQuery: '',
      targetSearchScope: 'context',
      statuses: ['draft'],
      matchMode: 'regex',
      qualityFilters: ['qa_issue'],
      firstRepeatOnly: false,
      sortBy: 'target_length',
      sortDirection: 'desc',
    });
  });

  it('restores the old first-repeat preset as an independent filter', () => {
    expect(
      sanitizePersistedEditorFilterState({ quickPreset: 'first_repeat', status: 'draft' }),
    ).toMatchObject({ firstRepeatOnly: true, statuses: ['draft'] });
  });

  it.each([
    ['unconfirmed', ['empty', 'draft']],
    ['confirmed', ['confirmed']],
  ])('converts the legacy %s preset to selected statuses', (quickPreset, statuses) => {
    expect(sanitizePersistedEditorFilterState({ quickPreset })).toMatchObject({ statuses });
  });

  it('converts the legacy issues preset and sanitizes duplicate multi-select values', () => {
    expect(sanitizePersistedEditorFilterState({ quickPreset: 'issues' }).qualityFilters).toEqual([
      'qa_issue',
      'save_error',
    ]);
    expect(
      sanitizePersistedEditorFilterState({ statuses: ['draft', 'invalid', 'draft', 'empty'] })
        .statuses,
    ).toEqual(['draft', 'empty']);
  });

  it('clears the retired untranslated quick preset from persisted state', () => {
    expect(sanitizePersistedEditorFilterState({ quickPreset: 'untranslated' })).toEqual(
      createDefaultEditorFilterCriteria(),
    );
  });

  it('builds searchable segment flags from segment and save errors', () => {
    const segments: Segment[] = [
      createSegment({
        id: 's1',
        status: 'empty',
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
    });
    expect(searchable[1]).toMatchObject({
      sourceText: 'World',
      targetText: '世界',
      hasQaIssue: true,
      hasSaveError: true,
    });
  });

  it('marks every occurrence of a repeated source hash, including the first', () => {
    const first = createSegment({ id: 's1', source: 'Repeat', target: '' });
    const second = createSegment({ id: 's2', source: 'Repeat', target: '' });
    const unique = createSegment({ id: 's3', source: 'Unique', target: '' });
    second.srcHash = first.srcHash;

    const searchable = buildSearchableEditorSegments([first, unique, second], {});

    expect(searchable.map((item) => item.repeatedSourceRole)).toEqual([
      'first',
      undefined,
      'later',
    ]);
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
});
