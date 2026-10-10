import { describe, expect, it } from 'vitest';
import type { FileQaIssueRecord } from '@cat/core/project';
import { groupQaIssuesByRow } from './qaResultGroups';

function finding(segmentId: string, row: number, ruleId = 'number'): FileQaIssueRecord {
  return { segmentId, row, ruleId, severity: 'info', message: 'Missing: 20' };
}

describe('QA row grouping', () => {
  it('uses segment identity and original row numbers while retaining category order and references', () => {
    const reference = { segmentId: 'reference', row: 2 };
    const issues = [
      { ...finding('later', 20, 'tb-term-missing'), groupId: 'term', references: [reference] },
      finding('earlier', 3, 'future-rule'),
      finding('earlier', 3, 'number'),
      finding('later', 20, 'tag-missing'),
      finding('same-row-number', 3),
    ];
    const rows = groupQaIssuesByRow(issues);
    expect(rows.map((row) => row.segmentId)).toEqual(['earlier', 'same-row-number', 'later']);
    expect(rows.map((row) => row.row)).toEqual([3, 3, 20]);
    expect(rows.map((row) => row.issues.length)).toEqual([2, 1, 2]);
    expect(rows[0].categories.map(([id]) => id)).toEqual(['number', 'future-rule']);
    expect(rows[2].categories.map(([id]) => id)).toEqual([
      'tag-integrity',
      'terminology-consistency',
    ]);
    expect([...rows[2].categories[1][1].groups.get('term')!.references.values()]).toEqual([
      reference,
    ]);
    expect(rows.flatMap((row) => row.issues)).toHaveLength(issues.length);
    expect(issues[0].segmentId).toBe('later');
  });

  it('retains every finding and affected row in large reports, excluding reference-only rows', () => {
    const issues = Array.from({ length: 650 }, (_, index) => ({
      ...finding('segment-' + index, 651 - index),
      references: [{ segmentId: 'reference', row: 1 }],
    }));
    const rows = groupQaIssuesByRow(issues);
    expect(rows).toHaveLength(650);
    expect(rows[0].row).toBe(2);
    expect(rows.at(-1)!.row).toBe(651);
    expect(rows.reduce((count, row) => count + row.issues.length, 0)).toBe(650);
    expect(rows.some((row) => row.segmentId === 'reference')).toBe(false);
  });
});
