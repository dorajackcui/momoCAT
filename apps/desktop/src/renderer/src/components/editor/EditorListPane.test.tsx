// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createEditorSegmentStore } from '../../hooks/editor/editorSegmentStore';
import { EditorListPane } from './EditorListPane';

vi.mock('../EditorRow', () => ({
  EditorRow: ({ segment }: { segment: Segment }) => <div>{segment.segmentId}</div>,
}));

afterEach(() => vi.restoreAllMocks());

it.each([64, 79.375])('positions %spx rows without overlap and scrolls', (rowHeight) => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-index') ? Math.round(rowHeight) : 640;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { height: this.hasAttribute('data-index') ? rowHeight : 640 } as DOMRect;
  });
  const segments = Array.from({ length: 100 }, (_, index) => ({
    segmentId: `segment-${index}`,
    sourceTokens: [],
    targetTokens: [],
    status: 'new',
  })) as Segment[];
  const store = createEditorSegmentStore(segments);
  const filteredSegments = segments.map((segment, originalIndex) => ({
    segment,
    originalIndex,
    sourceText: '',
    targetText: '',
    hasQaError: false,
    hasQaWarning: false,
    hasSaveError: false,
    hasIssue: false,
  }));
  const noop = () => {};

  function Harness() {
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    return (
      <div ref={setScrollElement} data-testid="scroll-container">
        <EditorListPane
          scrollElement={scrollElement}
          virtualized
          filteredSegments={filteredSegments}
          segmentStore={store}
          activeFilteredIndex={-1}
          activeSegmentId={null}
          manualActivationSegmentId={null}
          suppressAutoFocusSegmentId={null}
          isSearchInputFocused={false}
          onRowActivate={noop}
          onRowAutoFocus={noop}
          onTranslationChange={noop}
          onTranslationBlur={async () => {}}
          onSegmentEditStateChange={noop}
          onTargetEditorControllerChange={noop}
          onAITranslate={noop}
          onAIRefine={noop}
          onConfirm={noop}
          aiTranslatingSegmentIds={{}}
          segmentSaveErrors={{}}
          sourceHighlightQuery=""
          targetHighlightQuery=""
          contextHighlightQuery=""
          highlightMode="contains"
          showNonPrintingSymbols={false}
        />
      </div>
    );
  }

  render(<Harness />);
  expect(screen.getByText('segment-0')).toBeInTheDocument();
  const container = screen.getByTestId('scroll-container');
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-index]'));
  const rowTop = (row: HTMLElement) =>
    Number(row.style.transform.match(/translateY\((.+)px\)/)?.[1]);
  for (let index = 1; index < rows.length; index += 1) {
    expect(rowTop(rows[index]) - rowTop(rows[index - 1])).toBeCloseTo(rowHeight, 5);
  }
  fireEvent.scroll(container, { target: { scrollTop: rowHeight * 50 } });
  expect(screen.getByText('segment-50')).toBeInTheDocument();
  expect(screen.queryByText('segment-0')).not.toBeInTheDocument();
});
