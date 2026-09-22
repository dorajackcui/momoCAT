// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEditorSelection } from './useEditorSelection';

afterEach(cleanup);
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };

describe('editor segment selection', () => {
  it('selects a range in filtered display order and supports Ctrl/Cmd toggling', () => {
    const { result } = renderHook(() => useEditorSelection(1, ['s4', 's2', 's8', 's1'], 's4'));
    act(() => result.current.selectSegment('s8', { ...plain, shiftKey: true }));
    expect([...result.current.selectedIds]).toEqual(['s4', 's2', 's8']);
    act(() => result.current.selectSegment('s2', { ...plain, ctrlKey: true }));
    expect([...result.current.selectedIds]).toEqual(['s4', 's8']);
    act(() => result.current.selectSegment('s1', { ...plain, metaKey: true }));
    expect([...result.current.selectedIds]).toEqual(['s4', 's8', 's1']);
  });

  it('keeps the Shift anchor when extending backwards or shrinking a range', () => {
    const { result } = renderHook(() => useEditorSelection(1, ['a', 'b', 'c', 'd'], 'c'));
    act(() => result.current.selectSegment('a', { ...plain, shiftKey: true }));
    expect([...result.current.selectedIds]).toEqual(['a', 'b', 'c']);
    act(() => result.current.selectSegment('b', { ...plain, shiftKey: true }));
    expect([...result.current.selectedIds]).toEqual(['b', 'c']);
  });

  it('selects all filtered IDs including rows outside the viewport and drops hidden IDs', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `s${i}`);
    const { result, rerender } = renderHook(({ visible }) => useEditorSelection(1, visible, 's0'), {
      initialProps: { visible: ids },
    });
    act(() => result.current.selectAll());
    expect(result.current.selectedIds.size).toBe(2000);
    rerender({ visible: ['s8', 's99'] });
    expect([...result.current.selectedIds]).toEqual(['s8', 's99']);
    rerender({ visible: ids });
    expect([...result.current.selectedIds]).toEqual(['s8', 's99']);
  });

  it('does not select a hidden active row or fall back to it after deselecting', () => {
    const { result } = renderHook(() => useEditorSelection(1, ['a', 'b'], 'hidden'));
    expect(result.current.selectedIds.size).toBe(0);
    act(() => result.current.selectSegment('a', plain));
    act(() => result.current.selectSegment('a', { ...plain, ctrlKey: true }));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('ordinary activation restores single selection and file switches reset selection', () => {
    const { result, rerender } = renderHook(
      ({ fileId, active }) => useEditorSelection(fileId, ['a', 'b'], active),
      {
        initialProps: { fileId: 1, active: 'a' },
      },
    );
    act(() => result.current.selectAll());
    act(() => result.current.selectSingle('b'));
    rerender({ fileId: 1, active: 'b' });
    expect([...result.current.selectedIds]).toEqual(['b']);
    act(() => result.current.selectAll());
    rerender({ fileId: 2, active: 'a' });
    expect([...result.current.selectedIds]).toEqual(['a']);
  });
});
