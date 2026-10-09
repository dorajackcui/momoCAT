import { describe, expect, it } from 'vitest';
import type { QaHighlight } from '@cat/core/models';
import { buildEditorHighlightChunks } from './highlightRanges';
import { qaSelectionForIssues, selectedQaHighlights } from './qaHighlights';

const highlight: QaHighlight = {
  side: 'target',
  text: 'Read 12 now.',
  ranges: [{ start: 5, end: 7 }],
};
const matches = (text: string, highlights: QaHighlight[]) =>
  buildEditorHighlightChunks(text, '', 'contains', highlights)
    .filter((chunk) => chunk.isMatch)
    .map((chunk) => chunk.text);

describe('QA highlights in existing text marks', () => {
  it('highlights exact ranges and retains ordinary search marks', () => {
    expect(matches(highlight.text, [highlight])).toEqual(['12']);
    expect(
      buildEditorHighlightChunks(highlight.text, 'Read', 'contains', [highlight])
        .filter((chunk) => chunk.isMatch)
        .map((chunk) => chunk.text),
    ).toEqual(['Read', '12']);
  });
  it('hides stale snapshots and malformed ranges without disturbing text', () => {
    expect(matches('Read 13 now.', [highlight])).toEqual([]);
    expect(
      matches(highlight.text, [
        {
          ...highlight,
          ranges: [
            { start: -1, end: 7 },
            { start: 1, end: 99 },
          ],
        },
      ]),
    ).toEqual([]);
  });
  it('merges overlapping and adjacent ranges from multiple findings', () => {
    expect(
      matches(highlight.text, [highlight, { ...highlight, ranges: [{ start: 6, end: 8 }] }]),
    ).toEqual(['12 ']);
  });
  it('keeps category selection across terminology groups and updated finding types', () => {
    const issues = [
      {
        ruleId: 'tb-term-missing',
        groupId: 'a',
        severity: 'info' as const,
        message: 'Missing',
        highlights: [highlight],
      },
      {
        ruleId: 'term-conflict',
        groupId: 'b',
        severity: 'info' as const,
        message: 'Conflict',
        highlights: [highlight],
      },
    ];
    const selection = qaSelectionForIssues(issues.slice(0, 1), 'category');
    expect(selection).toEqual({ ruleIds: ['tb-term-missing', 'term-mark-count', 'term-conflict'] });
    expect(selectedQaHighlights(issues, selection, 'target')).toHaveLength(2);
  });
  it('limits marks to the selected group and side, and clears them on exit', () => {
    const issues = [
      {
        ruleId: 'number',
        severity: 'info' as const,
        message: 'Numbers',
        groupId: 'a',
        highlights: [highlight],
      },
      {
        ruleId: 'number',
        severity: 'info' as const,
        message: 'Other',
        groupId: 'b',
        highlights: [{ ...highlight, text: 'Other' }],
      },
    ];
    const selection = qaSelectionForIssues(issues.slice(0, 1));
    expect(selectedQaHighlights(issues, selection, 'target')).toEqual([highlight]);
    expect(selectedQaHighlights(issues, selection, 'source')).toEqual([]);
    expect(selectedQaHighlights(issues, undefined, 'target')).toEqual([]);
    expect(
      selectedQaHighlights([{ ...issues[0], highlights: undefined }], selection, 'target'),
    ).toEqual([]);
  });
});
