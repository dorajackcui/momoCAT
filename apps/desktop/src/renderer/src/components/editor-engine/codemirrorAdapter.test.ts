// @vitest-environment jsdom

import { redo, undo } from '@codemirror/commands';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { applyTermAtEditorSelection } from '../../hooks/editor/editorTokenPolicy';
import { codeMirrorEditorThemeSpec, createCodeMirrorAdapter } from './codemirrorAdapter';

describe('CodeMirror editor sizing', () => {
  it('leaves minimum row height to the shared target layer', () => {
    expect(codeMirrorEditorThemeSpec['.cm-content']).not.toHaveProperty('minHeight');
    expect(codeMirrorEditorThemeSpec['.cm-content']).toMatchObject({
      padding: '0',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
  });
});

describe('CodeMirror term insertion', () => {
  it('restores a preview text selection when focusing a newly active editor', () => {
    const adapter = createCodeMirrorAdapter({
      callbacks: {
        onTextChange: vi.fn(),
        onFocusChange: vi.fn(),
        onShortcutAction: vi.fn(),
      },
    });
    const host = document.createElement('div');
    document.body.append(host);

    try {
      adapter.mount(host, 'abcdef');
      adapter.focus(undefined, { anchor: 1, head: 4 });

      const view = EditorView.findFromDOM(host);
      expect(view?.state.selection.main).toMatchObject({ anchor: 1, head: 4 });
      expect(adapter.getSnapshot()).toMatchObject({
        selectionFrom: 1,
        selectionTo: 4,
        focused: true,
      });
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('preserves a middle caret across blur and moves it after the inserted term', () => {
    const onTextChange = vi.fn();
    const adapter = createCodeMirrorAdapter({
      callbacks: {
        onTextChange,
        onFocusChange: vi.fn(),
        onShortcutAction: vi.fn(),
      },
    });
    const host = document.createElement('div');
    const outsideButton = document.createElement('button');
    document.body.append(host, outsideButton);

    try {
      adapter.mount(host, 'Save file');
      const view = EditorView.findFromDOM(host);
      expect(view).not.toBeNull();
      view!.dispatch({ selection: { anchor: 4 } });
      view!.focus();
      outsideButton.focus();

      expect(adapter.getSnapshot()).toMatchObject({
        text: 'Save file',
        selectionFrom: 4,
        selectionTo: 4,
        focused: false,
      });
      expect(applyTermAtEditorSelection(adapter, 'document', 'default')).toBe(true);
      expect(onTextChange).toHaveBeenLastCalledWith('Save document file');
      expect(adapter.getSnapshot()).toMatchObject({
        text: 'Save document file',
        selectionFrom: 13,
        selectionTo: 13,
        focused: true,
      });
    } finally {
      adapter.destroy();
      host.remove();
      outsideButton.remove();
    }
  });

  it('replaces a selected phrase and leaves the caret after the replacement', () => {
    const onTextChange = vi.fn();
    const adapter = createCodeMirrorAdapter({
      callbacks: {
        onTextChange,
        onFocusChange: vi.fn(),
        onShortcutAction: vi.fn(),
      },
    });
    const host = document.createElement('div');
    const outsideButton = document.createElement('button');
    document.body.append(host, outsideButton);

    try {
      adapter.mount(host, 'Save old file');
      const view = EditorView.findFromDOM(host);
      expect(view).not.toBeNull();
      view!.dispatch({ selection: { anchor: 5, head: 8 } });
      view!.focus();
      outsideButton.focus();

      expect(applyTermAtEditorSelection(adapter, 'document', 'default')).toBe(true);
      expect(onTextChange).toHaveBeenLastCalledWith('Save document file');
      expect(adapter.getSnapshot()).toMatchObject({
        text: 'Save document file',
        selectionFrom: 13,
        selectionTo: 13,
        focused: true,
      });
    } finally {
      adapter.destroy();
      host.remove();
      outsideButton.remove();
    }
  });
});

describe('CodeMirror nonbreaking spaces', () => {
  const shortcut = () =>
    new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      ctrlKey: !/Mac/.test(navigator.platform),
      metaKey: /Mac/.test(navigator.platform),
      shiftKey: true,
    });

  it.each([
    { text: 'Salut!', anchor: 5, head: 5 },
    { text: 'Salut monde !', anchor: 5, head: 12 },
  ])('inserts NBSP at the caret or replaces a selection: $text', ({ text, anchor, head }) => {
    const onTextChange = vi.fn();
    const onShortcutAction = vi.fn();
    const adapter = createCodeMirrorAdapter({
      callbacks: { onTextChange, onFocusChange: vi.fn(), onShortcutAction },
      initialOptions: { showNonPrintingSymbols: true },
    });
    const host = document.createElement('div');
    document.body.append(host);
    try {
      adapter.mount(host, text);
      adapter.focus(undefined, { anchor, head });
      const view = EditorView.findFromDOM(host)!;
      expect(runScopeHandlers(view, shortcut(), 'editor')).toBe(true);
      expect(adapter.getSnapshot()).toMatchObject({
        text: 'Salut\u00A0!',
        selectionFrom: 6,
        selectionTo: 6,
      });
      expect(onTextChange).toHaveBeenLastCalledWith('Salut\u00A0!');
      expect(onShortcutAction).not.toHaveBeenCalled();
      expect(host.querySelector('.cm-np-nbsp')?.textContent).toBe('\u00A0');
      expect(undo(view)).toBe(true);
      expect(adapter.getSnapshot()).toMatchObject({
        text,
        selectionFrom: anchor,
        selectionTo: head,
      });
      expect(redo(view)).toBe(true);
      expect(adapter.getSnapshot().text).toBe('Salut\u00A0!');
      adapter.setOptions({ showNonPrintingSymbols: false });
      expect(host.querySelector('.cm-np-nbsp')).toBeNull();
      expect(adapter.getSnapshot().text).toBe('Salut\u00A0!');
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('does not insert NBSP into a read-only editor', () => {
    const onTextChange = vi.fn();
    const adapter = createCodeMirrorAdapter({
      callbacks: { onTextChange, onFocusChange: vi.fn(), onShortcutAction: vi.fn() },
    });
    const host = document.createElement('div');
    document.body.append(host);
    try {
      adapter.mount(host, 'Salut!');
      adapter.focus(undefined, { anchor: 5, head: 5 });
      adapter.setEditable(false);
      expect(runScopeHandlers(EditorView.findFromDOM(host)!, shortcut(), 'editor')).toBe(false);
      expect(adapter.getSnapshot().text).toBe('Salut!');
      expect(onTextChange).not.toHaveBeenCalled();
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});

describe('CodeMirror QA highlights', () => {
  it('uses the shared mark, updates selection options and removes stale marks immediately on edits', () => {
    const text = 'Read 12 now.';
    const adapter = createCodeMirrorAdapter({
      callbacks: { onTextChange: vi.fn(), onFocusChange: vi.fn(), onShortcutAction: vi.fn() },
      initialOptions: { qaHighlights: [{ side: 'target', text, ranges: [{ start: 5, end: 7 }] }] },
    });
    const host = document.createElement('div');
    document.body.append(host);
    try {
      adapter.mount(host, text);
      expect(host.querySelector('.cm-target-highlight')?.textContent).toBe('12');
      const view = EditorView.findFromDOM(host)!;
      view.dispatch({ changes: { from: 6, to: 7, insert: '3' } });
      expect(host.querySelector('.cm-target-highlight')).toBeNull();
      adapter.setOptions({
        qaHighlights: [{ side: 'target', text: 'Read 13 now.', ranges: [{ start: 5, end: 7 }] }],
      });
      expect(host.querySelector('.cm-target-highlight')?.textContent).toBe('13');
      adapter.setOptions({ qaHighlights: [] });
      expect(host.querySelector('.cm-target-highlight')).toBeNull();
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});
