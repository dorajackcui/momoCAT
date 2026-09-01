// @vitest-environment jsdom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorRowTargetCell, resolvePreviewSelection } from './EditorRowTargetCell';

function renderCell(overrides?: Partial<React.ComponentProps<typeof EditorRowTargetCell>>) {
  const props: React.ComponentProps<typeof EditorRowTargetCell> = {
    editorHostRef: { current: null },
    isActive: true,
    previewText: 'Translated preview',
    highlightQuery: '',
    highlightMode: 'contains',
    showNonPrintingSymbols: false,
    ...overrides,
  };
  const element = EditorRowTargetCell(props);
  if (!React.isValidElement(element)) {
    throw new Error('Expected EditorRowTargetCell to return a React element');
  }
  const content = React.Children.toArray(element.props.children)[0] as React.ReactElement;
  return { content };
}

describe('EditorRowTargetCell', () => {
  it('renders codemirror host with editor classes', () => {
    const { content } = renderCell();
    expect(content.props.className).toContain('editor-target-text-layer');
    expect(content.props.className).toContain('editor-target-editor-host');
  });

  it('renders lightweight text instead of a codemirror host when inactive', () => {
    const { content } = renderCell({ isActive: false });
    expect(content.props.className).toContain('editor-target-preview');
    expect(content.props.className).not.toContain('editor-target-editor-host');
    expect(content.props.children).toBe('Translated preview');
  });

  it('keeps target-search highlights in the lightweight inactive preview', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowTargetCell, {
        editorHostRef: { current: null },
        isActive: false,
        previewText: 'Needle target',
        highlightQuery: 'needle',
        highlightMode: 'contains',
        showNonPrintingSymbols: false,
      }),
    );

    expect(html).toContain('cm-target-highlight');
    expect(html).toContain('Needle');
  });

  it('visualizes non-printing symbols in the lightweight inactive preview', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowTargetCell, {
        editorHostRef: { current: null },
        isActive: false,
        previewText: 'A B\tC',
        highlightQuery: '',
        highlightMode: 'contains',
        showNonPrintingSymbols: true,
      }),
    );

    expect(html).not.toContain('A B\tC');
  });

  it('matches regex against raw whitespace before visualizing inactive preview text', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowTargetCell, {
        editorHostRef: { current: null },
        isActive: false,
        previewText: 'A B',
        highlightQuery: '\\s+',
        highlightMode: 'regex',
        showNonPrintingSymbols: true,
      }),
    );

    expect(html).toContain('cm-target-highlight');
  });

  it('maps a highlighted preview DOM selection to editor text offsets', () => {
    const root = document.createElement('div');
    const prefix = document.createTextNode('Alpha ');
    const mark = document.createElement('mark');
    const markedText = document.createTextNode('beta');
    mark.append(markedText);
    root.append(prefix, mark, document.createTextNode(' gamma'));

    expect(
      resolvePreviewSelection(
        root,
        {
          anchorNode: prefix,
          anchorOffset: 2,
          focusNode: markedText,
          focusOffset: 2,
          isCollapsed: false,
        },
        'Alpha beta gamma',
        false,
      ),
    ).toEqual({ anchor: 2, head: 8 });
  });

  it('removes visual-only line break markers from preview selection offsets', () => {
    const root = document.createElement('div');
    const text = document.createTextNode('A·B↵\nC');
    root.append(text);

    expect(
      resolvePreviewSelection(
        root,
        {
          anchorNode: text,
          anchorOffset: 2,
          focusNode: text,
          focusOffset: 5,
          isCollapsed: false,
        },
        'A B\nC',
        true,
      ),
    ).toEqual({ anchor: 2, head: 4 });
  });

  it('does not mistake literal non-printing glyphs for visualized whitespace', () => {
    const root = document.createElement('div');
    const text = document.createTextNode('A·⇥↵B');
    root.append(text);

    expect(
      resolvePreviewSelection(
        root,
        {
          anchorNode: text,
          anchorOffset: 1,
          focusNode: text,
          focusOffset: 4,
          isCollapsed: false,
        },
        'A·⇥↵B',
        true,
      ),
    ).toEqual({ anchor: 1, head: 4 });
  });
});
