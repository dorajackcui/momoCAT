import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createEditorSegmentStore } from '../../hooks/editor/editorSegmentStore';
import { buildSearchableEditorSegments } from '../../hooks/editor/editorSearchableSegments';
import { EditorListPane } from './EditorListPane';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock('../EditorRow', () => ({
  EditorRow: ({
    segment,
    repeatedSourceRole,
  }: {
    segment: Segment;
    repeatedSourceRole?: 'first' | 'later';
  }) =>
    React.createElement(
      'span',
      {
        'data-testid': `row-${segment.segmentId}`,
        'data-repeated-source-role': repeatedSourceRole ?? 'none',
      },
      segment.targetTokens.map((token) => token.content).join(''),
    ),
}));

function createSegment(targetText: string): Segment {
  return {
    segmentId: 'seg-1',
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'source' }],
    targetTokens: [{ type: 'text', content: targetText }],
    status: 'draft',
    tagsSignature: '',
    matchKey: 'seg-1',
    srcHash: 'seg-1',
    meta: {},
  };
}

describe('EditorListPane store-backed rows', () => {
  it('renders the current store snapshot when the searchable list still holds an old segment', () => {
    const previous = createSegment('before');
    const store = createEditorSegmentStore([previous]);
    const filteredSegments = buildSearchableEditorSegments([previous], {});
    store.updateSegment('seg-1', (segment) => ({
      ...segment,
      targetTokens: [{ type: 'text', content: 'after' }],
    }));

    const html = renderToStaticMarkup(
      React.createElement(EditorListPane, {
        scrollParentRef: { current: null },
        virtualized: false,
        filteredSegments,
        segmentStore: store,
        activeFilteredIndex: 0,
        activeSegmentId: 'seg-1',
        manualActivationSegmentId: null,
        suppressAutoFocusSegmentId: null,
        isSearchInputFocused: false,
        onRowActivate: vi.fn(),
        onRowAutoFocus: vi.fn(),
        onTranslationChange: vi.fn(),
        onTranslationBlur: vi.fn().mockResolvedValue(undefined),
        onSegmentEditStateChange: vi.fn(),
        onAITranslate: vi.fn(),
        onAIRefine: vi.fn(),
        onConfirm: vi.fn(),
        aiTranslatingSegmentIds: {},
        segmentSaveErrors: {},
        sourceHighlightQuery: '',
        targetHighlightQuery: '',
        highlightMode: 'contains',
        showNonPrintingSymbols: false,
      }),
    );

    expect(html).toContain('after');
    expect(html).not.toContain('before');
  });

  it('passes distinct first and later repeat roles to editor rows', () => {
    const first = createSegment('first');
    const repeated = {
      ...createSegment('second'),
      segmentId: 'seg-2',
      orderIndex: 1,
      srcHash: first.srcHash,
    };
    const store = createEditorSegmentStore([first, repeated]);
    const filteredSegments = buildSearchableEditorSegments([first, repeated], {});

    const html = renderToStaticMarkup(
      React.createElement(EditorListPane, {
        scrollParentRef: { current: null },
        virtualized: false,
        filteredSegments,
        segmentStore: store,
        activeFilteredIndex: 0,
        activeSegmentId: first.segmentId,
        manualActivationSegmentId: null,
        suppressAutoFocusSegmentId: null,
        isSearchInputFocused: false,
        onRowActivate: vi.fn(),
        onRowAutoFocus: vi.fn(),
        onTranslationChange: vi.fn(),
        onTranslationBlur: vi.fn().mockResolvedValue(undefined),
        onSegmentEditStateChange: vi.fn(),
        onAITranslate: vi.fn(),
        onAIRefine: vi.fn(),
        onConfirm: vi.fn(),
        aiTranslatingSegmentIds: {},
        segmentSaveErrors: {},
        sourceHighlightQuery: '',
        targetHighlightQuery: '',
        highlightMode: 'contains',
        showNonPrintingSymbols: false,
      }),
    );

    expect(html).toContain('data-testid="row-seg-1" data-repeated-source-role="first"');
    expect(html).toContain('data-testid="row-seg-2" data-repeated-source-role="later"');
  });
});
