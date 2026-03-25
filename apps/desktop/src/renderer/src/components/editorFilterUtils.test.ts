import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import {
  buildHighlightChunks,
  countActiveFilterFields,
  createDefaultEditorFilterCriteria,
  filterSearchableSegments,
  getQuickPresetPatch,
  sortSearchableSegments,
  textMatchesQuery,
  type SearchableEditorSegment,
} from './editorFilterUtils';

function makeSegment(segmentId: string, status: Segment['status']): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'source' }],
    targetTokens: [{ type: 'text', content: 'target' }],
    status,
    tagsSignature: '',
    matchKey: segmentId,
    srcHash: segmentId,
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

describe('editorFilterUtils.textMatchesQuery', () => {
  it('returns true for empty query', () => {
    expect(textMatchesQuery('Hello World', '')).toBe(true);
    expect(textMatchesQuery('Hello World', '   ')).toBe(true);
  });

  it('matches query case-insensitively', () => {
    expect(textMatchesQuery('Hello World', 'hello')).toBe(true);
    expect(textMatchesQuery('Hello World', 'WORLD')).toBe(true);
  });

  it('returns false when query is not found', () => {
    expect(textMatchesQuery('Hello World', 'bye')).toBe(false);
  });
});

describe('editorFilterUtils.filterSearchableSegments', () => {
  const segments: SearchableEditorSegment[] = [
    {
      segment: makeSegment('s1', 'new'),
      sourceText: 'Login successful',
      targetText: '',
      originalIndex: 0,
      hasQaError: false,
      hasQaWarning: false,
      hasSaveError: false,
      isUntranslated: true,
      hasIssue: false,
    },
    {
      segment: makeSegment('s2', 'draft'),
      sourceText: 'Order submitted',
      targetText: '订单已提交',
      originalIndex: 1,
      hasQaError: true,
      hasQaWarning: false,
      hasSaveError: false,
      isUntranslated: false,
      hasIssue: true,
    },
    {
      segment: makeSegment('s3', 'confirmed'),
      sourceText: 'Order cancelled',
      targetText: '订单已取消',
      originalIndex: 2,
      hasQaError: false,
      hasQaWarning: true,
      hasSaveError: true,
      isUntranslated: false,
      hasIssue: true,
    },
  ];

  it('keeps all segments when conditions are empty', () => {
    const filtered = filterSearchableSegments(segments, createDefaultEditorFilterCriteria());
    expect(filtered).toHaveLength(3);
  });

  it('filters with source query + target query + status together', () => {
    const filtered = filterSearchableSegments(segments, {
      sourceQuery: 'order',
      targetQuery: '提交',
      status: 'draft',
      matchMode: 'contains',
      qualityFilters: [],
      quickPreset: 'none',
      sortBy: 'default',
      sortDirection: 'asc',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].segment.segmentId).toBe('s2');
  });

  it('returns empty array when no segment matches', () => {
    const filtered = filterSearchableSegments(segments, {
      sourceQuery: 'order',
      targetQuery: '不存在',
      status: 'all',
      matchMode: 'contains',
      qualityFilters: [],
      quickPreset: 'none',
      sortBy: 'default',
      sortDirection: 'asc',
    });

    expect(filtered).toHaveLength(0);
  });

  it('supports quality filter + quick preset combination', () => {
    const filtered = filterSearchableSegments(segments, {
      sourceQuery: '',
      targetQuery: '',
      status: 'all',
      matchMode: 'contains',
      qualityFilters: ['qa_warning'],
      quickPreset: 'issues',
      sortBy: 'default',
      sortDirection: 'asc',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].segment.segmentId).toBe('s3');
  });
});

describe('editorFilterUtils.buildHighlightChunks', () => {
  it('splits text into matched and unmatched chunks', () => {
    const chunks = buildHighlightChunks('Hello hello world', 'hello');
    expect(chunks).toEqual([
      { text: 'Hello', isMatch: true },
      { text: ' ', isMatch: false },
      { text: 'hello', isMatch: true },
      { text: ' world', isMatch: false },
    ]);
  });

  it('returns a single non-match chunk when query is empty', () => {
    const chunks = buildHighlightChunks('No query', '');
    expect(chunks).toEqual([{ text: 'No query', isMatch: false }]);
  });

  it('returns an empty list for empty text input', () => {
    const chunks = buildHighlightChunks('', 'abc');
    expect(chunks).toEqual([]);
  });

  it('highlights the entire text for exact mode full match', () => {
    const chunks = buildHighlightChunks('Hello World', 'hello world', 'exact');
    expect(chunks).toEqual([{ text: 'Hello World', isMatch: true }]);
  });

  it('highlights regex matches', () => {
    const chunks = buildHighlightChunks('A-12 B-34', '[A-Z]-\\d+', 'regex');
    expect(chunks).toEqual([
      { text: 'A-12', isMatch: true },
      { text: ' ', isMatch: false },
      { text: 'B-34', isMatch: true },
    ]);
  });
});

describe('editorFilterUtils helpers', () => {
  it('creates default criteria and counts active fields', () => {
    const defaults = createDefaultEditorFilterCriteria();
    expect(defaults).toEqual({
      sourceQuery: '',
      targetQuery: '',
      status: 'all',
      matchMode: 'contains',
      qualityFilters: [],
      quickPreset: 'none',
      sortBy: 'default',
      sortDirection: 'asc',
    });
    expect(countActiveFilterFields(defaults)).toBe(0);
  });

  it('returns quick preset patch', () => {
    expect(getQuickPresetPatch('confirmed')).toEqual({
      status: 'all',
      qualityFilters: [],
      quickPreset: 'confirmed',
    });
  });
});

describe('editorFilterUtils.sortSearchableSegments', () => {
  const segments: SearchableEditorSegment[] = [
    {
      segment: makeSegment('s1', 'new'),
      sourceText: 'a',
      targetText: '1111',
      originalIndex: 0,
      hasQaError: false,
      hasQaWarning: false,
      hasSaveError: false,
      isUntranslated: false,
      hasIssue: false,
    },
    {
      segment: makeSegment('s2', 'new'),
      sourceText: 'abcd',
      targetText: '11',
      originalIndex: 1,
      hasQaError: false,
      hasQaWarning: false,
      hasSaveError: false,
      isUntranslated: false,
      hasIssue: false,
    },
    {
      segment: makeSegment('s3', 'new'),
      sourceText: 'ab',
      targetText: '1',
      originalIndex: 2,
      hasQaError: false,
      hasQaWarning: false,
      hasSaveError: false,
      isUntranslated: false,
      hasIssue: false,
    },
  ];

  it('sorts by source/target length with stable fallback order', () => {
    const bySourceAsc = sortSearchableSegments(segments, 'source_length', 'asc').map(
      (item) => item.segment.segmentId,
    );
    expect(bySourceAsc).toEqual(['s1', 's3', 's2']);

    const bySourceDesc = sortSearchableSegments(segments, 'source_length', 'desc').map(
      (item) => item.segment.segmentId,
    );
    expect(bySourceDesc).toEqual(['s2', 's3', 's1']);

    const byTargetAsc = sortSearchableSegments(segments, 'target_length', 'asc').map(
      (item) => item.segment.segmentId,
    );
    expect(byTargetAsc).toEqual(['s3', 's2', 's1']);
  });
});

describe('editorFilterUtils.textMatchesQuery mode', () => {
  it('supports contains/exact/regex modes', () => {
    expect(textMatchesQuery('Alpha Beta', 'beta', 'contains')).toBe(true);
    expect(textMatchesQuery('Alpha Beta', 'alpha beta', 'exact')).toBe(true);
    expect(textMatchesQuery('ID-123', '^ID-\\d+$', 'regex')).toBe(true);
  });

  it('fails safely on invalid regex', () => {
    expect(textMatchesQuery('Alpha', '[', 'regex')).toBe(false);
  });
});
