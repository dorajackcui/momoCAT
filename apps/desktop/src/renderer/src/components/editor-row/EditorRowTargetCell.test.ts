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
        previewText: 'A B\u00A0C\u202FD\tE',
        highlightQuery: '',
        highlightMode: 'contains',
        showNonPrintingSymbols: true,
      }),
    );

    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.textContent).toBe('A B\u00A0C\u202FD\tE');
    expect(root.querySelector('.cm-np-nbsp')?.textContent).toBe('\u00A0');
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
      resolvePreviewSelection(root, {
        anchorNode: prefix,
        anchorOffset: 2,
        focusNode: markedText,
        focusOffset: 2,
        isCollapsed: false,
      }),
    ).toEqual({ anchor: 2, head: 8 });
  });

  it('preserves offsets across decorated spaces and line breaks', () => {
    const { content } = renderCell({
      isActive: false,
      previewText: 'A B\nC',
      showNonPrintingSymbols: true,
    });
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(content);
    const preview = root.querySelector<HTMLElement>('.editor-target-preview')!;
    const beforeBreak = preview.querySelector('.cm-np-newline')!.previousSibling!;
    const afterBreak = preview.querySelector('.cm-np-newline')!.nextSibling!;
    expect(preview.textContent).toBe('A B\nC');

    expect(
      resolvePreviewSelection(preview, {
        anchorNode: beforeBreak,
        anchorOffset: 0,
        focusNode: afterBreak,
        focusOffset: 1,
        isCollapsed: false,
      }),
    ).toEqual({ anchor: 2, head: 4 });
  });

  it('does not mistake literal non-printing glyphs for visualized whitespace', () => {
    const root = document.createElement('div');
    const text = document.createTextNode('A·⇥↵B');
    root.append(text);

    expect(
      resolvePreviewSelection(root, {
        anchorNode: text,
        anchorOffset: 1,
        focusNode: text,
        focusOffset: 4,
        isCollapsed: false,
      }),
    ).toEqual({ anchor: 1, head: 4 });
  });
});
