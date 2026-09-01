// @vitest-environment jsdom

import { EditorView } from '@codemirror/view';
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
