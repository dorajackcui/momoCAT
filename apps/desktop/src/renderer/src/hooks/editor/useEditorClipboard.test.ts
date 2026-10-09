// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipboardEvent } from 'react';
import type { Segment } from '@cat/core/models';
import { useEditorClipboard } from './useEditorClipboard';
import { feedbackService } from '../../services/feedbackService';

vi.mock('../../services/feedbackService', () => ({
  feedbackService: { success: vi.fn(), error: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

function setup(selectedIds = new Set(['c', 'a'])) {
  const pasteSegments = vi.fn().mockResolvedValue(undefined);
  const getSegment = (id: string) =>
    ({
      sourceTokens: [{ type: 'text', content: id }],
      targetTokens: [{ type: 'text', content: `draft ${id}` }],
    }) as Segment;
  const hook = renderHook(
    ({ fileId, disabled, isRowSelection }) =>
      useEditorClipboard({
        fileId,
        disabled,
        isRowSelection,
        orderedIds: ['a', 'b', 'c'],
        selectedIds,
        getSegment,
        pasteSegments,
      }),
    { initialProps: { fileId: 1, disabled: false, isRowSelection: true } },
  );
  const event = (text: string, html = '', selector = 'div') => {
    const root = document.createElement('div');
    root.className = 'editor-scrollbar';
    const target = document.createElement(selector);
    root.append(target);
    const data = { 'text/plain': text, 'text/html': html };
    return {
      target,
      clipboardData: { getData: (type: keyof typeof data) => data[type], setData: vi.fn() },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ClipboardEvent<HTMLDivElement>;
  };
  return { ...hook, event, pasteSegments };
}

describe('preview text clipboard routing', () => {
  it.each(['editor-source-text', 'editor-target-preview'])(
    'copies exact whitespace and literal symbols from %s without display decorations',
    (className) => {
      const hook = setup(new Set());
      hook.rerender({ fileId: 1, disabled: true, isRowSelection: false });
      const event = hook.event('');
      const root = (event.target as HTMLElement).parentElement!;
      const preview = event.target as HTMLElement;
      preview.className = className;
      preview.innerHTML =
        'Avant<mark>\u00A0!<span class="cm-np-newline"></span>\n</mark>\u202F·⇥↵\n';
      document.body.append(root);
      try {
        const range = document.createRange();
        range.selectNodeContents(preview);
        window.getSelection()!.addRange(range);
        act(() => hook.result.current.onCopy(event));
        expect(event.clipboardData.setData).toHaveBeenCalledWith(
          'text/plain',
          'Avant\u00A0!\n\u202F·⇥↵\n',
        );
        expect(event.preventDefault).toHaveBeenCalled();
        expect(feedbackService.success).not.toHaveBeenCalled();
        expect(hook.pasteSegments).not.toHaveBeenCalled();
      } finally {
        root.remove();
      }
    },
  );

  it('leaves input copy native when a previous preview selection is retained', () => {
    const hook = setup();
    const event = hook.event('', '', 'input');
    const root = (event.target as HTMLElement).parentElement!;
    const preview = document.createElement('div');
    preview.className = 'editor-source-text';
    preview.textContent = 'Source\u00A0text';
    root.append(preview);
    document.body.append(root);
    try {
      const range = document.createRange();
      range.selectNodeContents(preview);
      window.getSelection()!.addRange(range);
      act(() => hook.result.current.onCopy(event));
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.clipboardData.setData).not.toHaveBeenCalled();
    } finally {
      root.remove();
    }
  });

  it('leaves selections crossing cells native rather than treating them as a row copy', () => {
    const hook = setup();
    const event = hook.event('');
    const root = (event.target as HTMLElement).parentElement!;
    const source = event.target as HTMLElement;
    source.className = 'editor-source-text';
    source.textContent = 'Source';
    const target = document.createElement('div');
    target.className = 'editor-target-preview';
    target.textContent = 'Target';
    root.append(target);
    document.body.append(root);
    try {
      const range = document.createRange();
      range.setStart(source.firstChild!, 1);
      range.setEnd(target.firstChild!, 2);
      window.getSelection()!.addRange(range);
      act(() => hook.result.current.onCopy(event));
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.clipboardData.setData).not.toHaveBeenCalled();
    } finally {
      root.remove();
    }
  });
});

describe('row clipboard routing', () => {
  it('copies current drafts in display order without saving', () => {
    const hook = setup();
    const event = hook.event('');
    act(() => hook.result.current.onCopy(event));
    expect(event.clipboardData.setData).toHaveBeenCalledWith(
      'text/plain',
      'a\tdraft a\nc\tdraft c',
    );
    expect(event.preventDefault).toHaveBeenCalled();
    expect(hook.pasteSegments).not.toHaveBeenCalled();
  });

  it('pastes tables into the exact selected rows and rejects count mismatches', () => {
    const hook = setup();
    act(() => hook.result.current.onPaste(hook.event('source\tnew a\nsource\tnew c')));
    expect(hook.pasteSegments).toHaveBeenCalledWith(['a', 'c'], ['new a', 'new c']);
    hook.pasteSegments.mockClear();
    act(() => hook.result.current.onPaste(hook.event('source\tonly one')));
    expect(hook.pasteSegments).not.toHaveBeenCalled();
    expect(feedbackService.error).toHaveBeenCalledWith(expect.stringContaining('2 selected'));
  });

  it('asks only for plain multiline text and supports either interpretation', () => {
    const hook = setup();
    act(() => hook.result.current.onPaste(hook.event('first\nsecond')));
    expect(hook.pasteSegments).not.toHaveBeenCalled();
    act(() => hook.result.current.choosePaste(false));
    expect(hook.pasteSegments).toHaveBeenLastCalledWith(['a'], ['first\nsecond']);
    act(() => hook.result.current.onPaste(hook.event('first\nsecond')));
    act(() => hook.result.current.choosePaste(true));
    expect(hook.pasteSegments).toHaveBeenLastCalledWith(['a', 'c'], ['first', 'second']);
  });

  it('cancels pending choices on file changes and leaves text inputs and ordinary editing alone', () => {
    const hook = setup();
    act(() => hook.result.current.onPaste(hook.event('first\nsecond')));
    hook.rerender({ fileId: 2, disabled: false, isRowSelection: true });
    expect(hook.result.current.pendingPaste).toBeNull();
    act(() => hook.result.current.choosePaste(true));
    const input = hook.event('text', '', 'input');
    act(() => hook.result.current.onPaste(input));
    expect(input.preventDefault).not.toHaveBeenCalled();
    hook.rerender({ fileId: 2, disabled: false, isRowSelection: false });
    const text = hook.event('first\nsecond');
    act(() => hook.result.current.onPaste(text));
    expect(text.preventDefault).not.toHaveBeenCalled();
    expect(hook.pasteSegments).not.toHaveBeenCalled();
  });

  it('keeps multiline text in a single selected row without asking', () => {
    const hook = setup(new Set(['a']));
    act(() => hook.result.current.onPaste(hook.event('first\nsecond')));
    expect(hook.result.current.pendingPaste).toBeNull();
    expect(hook.pasteSegments).toHaveBeenCalledWith(['a'], ['first\nsecond']);
  });

  it('routes body clipboard events to the focused row gutter', () => {
    const hook = setup();
    const root = document.createElement('div');
    root.className = 'editor-scrollbar';
    const gutter = document.createElement('button');
    root.append(gutter);
    document.body.append(root);
    gutter.focus();
    try {
      const event = hook.event('');
      Object.defineProperty(event, 'target', { value: document.body });
      act(() => hook.result.current.onCopy(event));
      expect(event.clipboardData.setData).toHaveBeenCalledWith(
        'text/plain',
        'a\tdraft a\nc\tdraft c',
      );
    } finally {
      root.remove();
    }
  });

  it('leaves clipboard shortcuts inside the text editor native even with a retained multi-selection', () => {
    const hook = setup();
    const event = hook.event('first\nsecond');
    (event.target as HTMLElement).className = 'cm-content';
    act(() => {
      hook.result.current.onCopy(event);
      hook.result.current.onPaste(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.clipboardData.setData).not.toHaveBeenCalled();
    expect(hook.pasteSegments).not.toHaveBeenCalled();
    expect(hook.result.current.pendingPaste).toBeNull();
  });

  it('blocks paste while a write is running', () => {
    const hook = setup();
    hook.rerender({ fileId: 1, disabled: true, isRowSelection: true });
    act(() => hook.result.current.onPaste(hook.event('a\t1\nc\t2')));
    expect(hook.pasteSegments).not.toHaveBeenCalled();
  });
});
