// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { createEditorSegmentStore } from './editorSegmentStore';
import { useEditorFilters } from '../useEditorFilters';
import { useEditorQA } from './useEditorQA';

const row = (id: string, target = 'apple'): Segment => ({
  segmentId: id,
  fileId: 1,
  orderIndex: 0,
  sourceTokens: [{ type: 'text', content: id }],
  targetTokens: [{ type: 'text', content: target }],
  status: 'draft',
  srcHash: id,
  matchKey: id,
  tagsSignature: '',
  meta: {},
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup(rows = [row('a'), row('b', 'pear')]) {
  const store = createEditorSegmentStore(rows);
  const setActiveSegmentId = vi.fn();
  const hook = renderHook(() =>
    useEditorFilters({
      fileId: 1,
      segmentStore: store,
      segmentSaveErrors: {},
      activeSegmentId: 'a',
      setActiveSegmentId,
    }),
  );
  return { ...hook, store, setActiveSegmentId };
}

it('retains view identity and membership through edits; changed criteria see every batched update', () => {
  const h = setup();
  act(() => h.result.current.toggleStatusFilter('draft'));
  const ids = h.result.current.visibleIds,
    rows = h.result.current.visibleRows;
  act(() => {
    h.store.updateSegment('a', (s) => ({ ...s, status: 'empty', targetTokens: [] }));
    h.store.updateSegment('b', (s) => ({ ...s, status: 'empty', targetTokens: [] }));
  });
  h.rerender();
  expect(h.result.current.visibleIds).toBe(ids);
  expect(h.result.current.visibleRows).toBe(rows);
  act(() => {
    h.result.current.toggleStatusFilter('draft');
    h.result.current.toggleStatusFilter('empty');
  });
  expect(h.result.current.visibleIds).toEqual(['a', 'b']);
});

it('rebuilds after document replacement and preserves a hidden active row', () => {
  const h = setup();
  act(() => h.result.current.applyQAFilter(['b'], 'QA path'));
  expect(h.result.current.visibleIds).toEqual(['b']);
  expect(h.setActiveSegmentId).not.toHaveBeenCalled();
  act(() => h.store.replaceAll([row('b')]));
  expect(h.result.current.visibleIds).toEqual(['b']);
  expect(h.setActiveSegmentId).toHaveBeenCalledWith('b');
});

it('retains displayed sort order through edits and refreshes using current content', () => {
  const h = setup();
  act(() => h.result.current.handleSortChange('target_length', 'asc'));
  expect(h.result.current.visibleIds).toEqual(['b', 'a']);
  act(() =>
    h.store.updateSegment('b', (s) => ({
      ...s,
      targetTokens: [{ type: 'text', content: 'a much longer target' }],
    })),
  );
  h.rerender();
  expect(h.result.current.visibleIds).toEqual(['b', 'a']);
  act(() => h.result.current.handleSortChange('target_length', 'desc'));
  expect(h.result.current.visibleIds).toEqual(['b', 'a']);
  act(() => h.result.current.handleSortChange('target_length', 'asc'));
  expect(h.result.current.visibleIds).toEqual(['a', 'b']);
});

it('resolves immediate text and QA scopes from current content before debounce', () => {
  vi.useFakeTimers();
  const h = setup();
  act(() => h.result.current.applyQAFilter(['a'], 'QA path'));
  act(() =>
    h.store.updateSegment('a', (s) => ({
      ...s,
      targetTokens: [{ type: 'text', content: 'latest' }],
    })),
  );
  act(() => h.result.current.setTargetQueryInput('latest'));
  expect(h.result.current.debouncedTargetQuery).toBe('');
  expect(h.result.current.getFilteredSegmentIds()).toEqual(['a']);
  act(() => vi.advanceTimersByTime(120));
  expect(h.result.current.visibleIds).toEqual(['a']);
  act(() => h.result.current.toggleTargetSearchScope());
  expect(h.result.current.visibleIds).toEqual([]);
});

it('does no document scan or parent rerender while typing into a stable large view', () => {
  const store = createEditorSegmentStore(
    Array.from({ length: 10000 }, (_, i) => ({
      ...row(String(i)),
      orderIndex: i,
      qaIssues:
        i % 5 === 0 ? [{ ruleId: 'number', severity: 'info' as const, message: 'finding' }] : [],
    })),
  );
  let renders = 0;
  const h = renderHook(() => {
    renders++;
    const filters = useEditorFilters({
      fileId: 1,
      segmentStore: store,
      segmentSaveErrors: {},
      activeSegmentId: '0',
      setActiveSegmentId: vi.fn(),
    });
    const qa = useEditorQA(1, store);
    return { filters, qa };
  });
  act(() => h.result.current.filters.toggleStatusFilter('draft'));
  act(() =>
    store.updateSegment('0', (s) => ({
      ...s,
      targetTokens: [{ type: 'text', content: 'first edit' }],
    })),
  );
  const scan = vi.spyOn(store, 'getSegments'),
    before = renders,
    issues = h.result.current.qa.issues,
    view = h.result.current.filters.visibleRows;
  for (let i = 0; i < 20; i++)
    act(() =>
      store.updateSegment('0', (s) => ({
        ...s,
        targetTokens: [{ type: 'text', content: 'edit' + i }],
      })),
    );
  expect(scan).not.toHaveBeenCalled();
  expect(renders).toBe(before);
  expect(h.result.current.qa.issues).toBe(issues);
  expect(h.result.current.filters.visibleRows).toBe(view);
  expect(h.result.current.qa.stale).toBe(true);
});
