// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { useEditorFilters } from './useEditorFilters';

const statuses = ['empty', 'draft', 'confirmed'] as const;
const segments = statuses.flatMap((status, group) =>
  ['first', 'later', 'unique'].map(
    (role, index): Segment => ({
      segmentId: `${status}-${role}`,
      fileId: 1,
      orderIndex: group * 3 + index,
      sourceTokens: [{ type: 'text', content: `${status}-${role === 'unique' ? role : 'repeat'}` }],
      targetTokens: status === 'empty' ? [] : [{ type: 'text', content: 'Translation' }],
      status,
      tagsSignature: '',
      matchKey: status,
      srcHash: `${status}-${role === 'unique' ? role : 'repeat'}`,
      meta: { updatedAt: '2026-01-01T00:00:00.000Z' },
      qaIssues:
        role === 'first' && status !== 'confirmed'
          ? [
              {
                ruleId: 'fixture',
                severity: status === 'empty' ? 'error' : 'warning',
                message: 'QA fixture',
              },
            ]
          : [],
    }),
  ),
);

function setup() {
  return renderHook(() =>
    useEditorFilters({
      fileId: 1,
      segments,
      segmentSaveErrors: { 'confirmed-first': 'Save failed' },
      activeSegmentId: null,
      setActiveSegmentId: vi.fn(),
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('first repeat and status filters', () => {
  it('ORs choices within Status and QA, then intersects them with First repetition', () => {
    const { result } = setup();
    act(() => result.current.toggleStatusFilter('empty'));
    act(() => result.current.toggleStatusFilter('draft'));
    act(() => result.current.toggleFirstRepeatOnly());
    expect(result.current.getFilteredSegmentIds()).toEqual(['empty-first', 'draft-first']);
    expect(result.current.activeFilterCount).toBe(2);

    act(() => result.current.toggleQualityFilter('qa_error'));
    expect(result.current.getFilteredSegmentIds()).toEqual(['empty-first']);
    act(() => result.current.toggleQualityFilter('qa_warning'));
    expect(result.current.getFilteredSegmentIds()).toEqual(['empty-first', 'draft-first']);
    expect(result.current.activeFilterCount).toBe(3);

    act(() => result.current.toggleStatusFilter('empty'));
    expect(result.current.getFilteredSegmentIds()).toEqual(['draft-first']);
    act(() => result.current.toggleStatusFilter('all'));
    expect(result.current.qualityFilters).toEqual(['qa_error', 'qa_warning']);
    expect(result.current.firstRepeatOnly).toBe(true);
    act(() => result.current.toggleQualityFilter('save_error'));
    expect(result.current.getFilteredSegmentIds()).toEqual([
      'empty-first',
      'draft-first',
      'confirmed-first',
    ]);
    act(() => result.current.toggleQualityFilter('all'));
    expect(result.current.qualityFilters).toEqual([]);
    expect(result.current.firstRepeatOnly).toBe(true);
  });

  it('returns a group to All when its last selected choice is deselected', () => {
    const { result } = setup();
    act(() => result.current.toggleStatusFilter('draft'));
    act(() => result.current.toggleStatusFilter('draft'));
    act(() => result.current.toggleQualityFilter('qa_error'));
    act(() => result.current.toggleQualityFilter('qa_error'));
    expect(result.current.statusFilters).toEqual([]);
    expect(result.current.qualityFilters).toEqual([]);
    expect(result.current.getFilteredSegmentIds()).toBeNull();
  });

  it.each(statuses)('intersects first repeats with %s regardless of selection order', (status) => {
    const { result } = setup();
    act(() => result.current.toggleFirstRepeatOnly());
    act(() => result.current.toggleStatusFilter(status));
    expect(result.current.firstRepeatOnly).toBe(true);
    expect(result.current.getFilteredSegmentIds()).toEqual([`${status}-first`]);

    act(() => result.current.toggleFirstRepeatOnly());
    expect(result.current.statusFilters).toEqual([status]);
    expect(result.current.getFilteredSegmentIds()).toEqual([
      `${status}-first`,
      `${status}-later`,
      `${status}-unique`,
    ]);
    act(() => result.current.toggleFirstRepeatOnly());
    expect(result.current.getFilteredSegmentIds()).toEqual([`${status}-first`]);
    act(() => result.current.toggleStatusFilter('all'));
    expect(result.current.getFilteredSegmentIds()).toEqual(
      statuses.map((value) => `${value}-first`),
    );
  });

  it('restores both filters and clears the toggle with the rest of the filters', () => {
    const initial = setup();
    act(() => initial.result.current.toggleStatusFilter('draft'));
    act(() => initial.result.current.toggleStatusFilter('empty'));
    act(() => initial.result.current.toggleFirstRepeatOnly());
    initial.unmount();
    const restored = setup();
    expect(restored.result.current.statusFilters).toEqual(['draft', 'empty']);
    expect(restored.result.current.firstRepeatOnly).toBe(true);
    expect(restored.result.current.getFilteredSegmentIds()).toEqual(['empty-first', 'draft-first']);
    act(() => restored.result.current.clearFilters());
    expect(restored.result.current.firstRepeatOnly).toBe(false);
    expect(restored.result.current.getFilteredSegmentIds()).toBeNull();
  });
});
