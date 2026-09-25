import { describe, expect, it } from 'vitest';
import type { TMEntryRow } from '../../types';
import type { TMRecallDbRow } from './tmEntryRows';
import { diversifyConcordanceRows, diversifyRecallRows } from './tmRecallDiversity';

type TestRow = TMRecallDbRow & TMEntryRow;

function row(id: string, source: string, target = ''): TestRow {
  const sourceTokens = [{ type: 'text' as const, content: source }];
  const targetTokens = [{ type: 'text' as const, content: target }];
  return {
    id,
    tmId: 'tm',
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'zh',
    srcHash: id,
    matchKey: source,
    tagsSignature: '',
    sourceTokens,
    targetTokens,
    sourceTokensJson: JSON.stringify(sourceTokens),
    targetTokensJson: JSON.stringify(targetTokens),
    ftsSrcText: source,
    ftsTgtText: target,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    usageCount: 1,
  };
}

const selectors = [
  {
    name: 'source recall',
    select: (query: string, rows: TestRow[], limit: number) =>
      diversifyRecallRows(query, rows, limit, 'source'),
  },
  {
    name: 'source-and-target recall',
    select: (query: string, rows: TestRow[], limit: number) =>
      diversifyRecallRows(query, rows, limit, 'source-and-target'),
  },
  {
    name: 'explicit concordance',
    select: (query: string, rows: TestRow[], limit: number) =>
      diversifyConcordanceRows(query, rows, limit),
  },
];

describe.each(selectors)('TM diversity: $name', ({ select }) => {
  it.each([
    { name: 'English', query: 'Open the settings', source: 'Open the settings', count: 3 },
    { name: 'three Han characters', query: '数据库', source: '数据库', count: 3 },
    { name: 'separated Han runs', query: '中文 测试', source: '中文 测试', count: 3 },
    { name: 'four Han characters', query: '中文测试', source: '中文测试', count: 2 },
    { name: 'normalized query', query: '\t中文测试\n', source: '中文测试', count: 2 },
    { name: 'mixed query', query: 'Open 中文测试 now', source: '中文测试', count: 2 },
    {
      name: 'longer mixed overlap',
      query: 'Open 中文测试 now',
      source: 'Open 中文测试 now',
      count: 3,
    },
    { name: 'inclusive Han range boundary', query: '龥龥龥龥', source: '龥龥龥龥', count: 2 },
    { name: 'outside existing Han range', query: '龦龦龦龦', source: '龦龦龦龦', count: 3 },
    { name: 'supplementary Han characters', query: '𠀀𠀀𠀀𠀀', source: '𠀀𠀀𠀀𠀀', count: 3 },
    { name: 'empty query', query: '', source: '中文测试', count: 3 },
  ])('preserves ordered selection for $name', ({ query, source, count }) => {
    const rows = ['first', 'second', 'third'].map((id) => row(id, source));

    expect(select(query, rows, 3)).toEqual(rows.slice(0, count));
    expect(select(query, rows, 1)).toEqual(rows.slice(0, 1));
  });

  it('fills the result limit after suppressing repeated CJK buckets', () => {
    const rows = [
      row('first', '中文测试'),
      row('second', '中文测试'),
      row('third', '中文测试'),
      row('fourth', '数据处理'),
    ];

    expect(select('中文测试 数据处理', rows, 3)).toEqual([rows[0], rows[1], rows[3]]);
  });
});

it('preserves target-side grouping and the longest-overlap rule for mixed text', () => {
  const rows = ['first', 'second', 'third'].map((id) =>
    row(id, '中文测试', 'long english overlap'),
  );
  const query = '中文测试 long english overlap';

  expect(diversifyRecallRows(query, rows, 3, 'source')).toEqual(rows.slice(0, 2));
  expect(diversifyRecallRows(query, rows, 3, 'source-and-target')).toEqual(rows);
  expect(diversifyConcordanceRows(query, rows, 3)).toEqual(rows);

  const targetRows = rows.map((entry) => row(entry.id, 'English source', '中文测试'));
  expect(diversifyRecallRows('中文测试', targetRows, 3, 'source')).toEqual(targetRows);
  expect(diversifyRecallRows('中文测试', targetRows, 3, 'source-and-target')).toEqual(
    targetRows.slice(0, 2),
  );
  expect(diversifyConcordanceRows('中文测试', targetRows, 3)).toEqual(targetRows.slice(0, 2));
});
