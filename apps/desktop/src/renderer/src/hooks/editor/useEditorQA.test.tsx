// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { evaluateDocumentQa } from '@cat/core/qa';
import { normalizeQASettings } from '@cat/core/project';
import { createEditorSegmentStore } from './editorSegmentStore';
import { createSegmentChangeHint } from './editorSegmentState';
import { useEditorQA } from './useEditorQA';

const segment: Segment = {
  segmentId: 'a',
  fileId: 1,
  orderIndex: 0,
  status: 'draft',
  sourceTokens: [{ type: 'text', content: 'Count 1' }],
  targetTokens: [{ type: 'text', content: 'Count 2' }],
  srcHash: '',
  matchKey: '',
  tagsSignature: '',
  meta: { updatedAt: '' },
};

describe('QA completion while the editor remains interactive', () => {
  it('discards a result when resources change during a run even with no previous findings', () => {
    const store = createEditorSegmentStore([segment]);
    const { result } = renderHook(() =>
      useEditorQA(1, store, createSegmentChangeHint(undefined, 0), vi.fn()),
    );
    act(() => result.current.startRun());
    store.invalidateQA();
    act(() => result.current.acceptReport(evaluateDocumentQa([segment])));
    expect(result.current.stale).toBe(true);
    expect(result.current.issues).toEqual([]);
  });

  it('goes stale on content edit but keeps document findings visible until recheck', () => {
    const store = createEditorSegmentStore([segment, { ...segment, segmentId: 'b' }]);
    const options = { settings: normalizeQASettings({ enabledRuleIds: ['number'] }) };
    let revision = 0;
    const { result, rerender } = renderHook(() =>
      useEditorQA(
        1,
        store,
        createSegmentChangeHint({ orderChanged: false, changedSegmentIds: ['a', 'b'] }, revision),
        vi.fn(),
      ),
    );
    act(() => result.current.startRun());
    act(() => result.current.acceptReport(evaluateDocumentQa(store.getSegments(), options)));
    const issues = result.current.issues;
    const otherRowIssues = store.getSegment('b')?.qaIssues;
    store.updateSegment('a', (row) => ({ ...row, status: 'confirmed' }));
    revision++;
    rerender();
    expect(result.current.stale).toBe(false);
    expect(result.current.issues).toEqual(issues);
    store.updateSegment('a', (row) => ({
      ...row,
      targetTokens: [{ type: 'text', content: 'Count 1' }],
    }));
    revision++;
    rerender();
    expect(result.current.stale).toBe(true);
    expect(result.current.issues).toEqual(issues);
    expect(store.getSegment('b')?.qaIssues).toEqual(otherRowIssues);
    store.updateSegment('a', (row) => ({
      ...row,
      qaIssues: [{ ruleId: 'instant', message: 'Instant result', severity: 'info' }],
    }));
    revision++;
    rerender();
    expect(result.current.issues.map((issue) => issue.ruleId)).toEqual(['instant', 'number']);
    act(() => result.current.startRun());
    act(() => result.current.acceptReport(evaluateDocumentQa(store.getSegments(), options)));
    expect(result.current.stale).toBe(false);
    expect(store.getSegment('a')?.qaIssues).toEqual([]);
    expect(result.current.issues.map((issue) => issue.segmentId)).toEqual(['b']);
  });
  it.each(['unchanged', 'edited', 'server-stale'] as const)('%s content', (mode) => {
    const store = createEditorSegmentStore([segment]);
    const publish = vi.fn();
    const { result } = renderHook(() =>
      useEditorQA(1, store, createSegmentChangeHint(undefined, 0), publish),
    );
    act(() => result.current.startRun());
    const report = evaluateDocumentQa([segment], {
      settings: normalizeQASettings({ enabledRuleIds: ['number'] }),
    });
    if (mode === 'edited')
      store.updateSegment('a', (current) => ({
        ...current,
        targetTokens: [{ type: 'text', content: 'Retained edit' }],
      }));
    if (mode === 'server-stale') report.stale = true;
    act(() => result.current.acceptReport(report));
    expect(result.current.stale).toBe(mode !== 'unchanged');
    expect(result.current.issues).toHaveLength(mode === 'unchanged' ? 1 : 0);
    expect(publish).toHaveBeenCalledTimes(mode === 'unchanged' ? 1 : 0);
    expect(store.getSegment('a')?.targetTokens[0].content).toBe(
      mode === 'edited' ? 'Retained edit' : 'Count 2',
    );
    expect(store.getSegment('a')?.qaIssues?.length ?? 0).toBe(mode === 'unchanged' ? 1 : 0);
  });
});
