import { qaGroupForRule, type FileQaIssueRecord } from '@cat/core/project';
import { QA_GROUP_ORDER } from '../qaSections';

export function groupQaIssues(issues: FileQaIssueRecord[]) {
  type Group = {
    label: string;
    issues: FileQaIssueRecord[];
    rows: Map<string, FileQaIssueRecord[]>;
    references: Map<string, NonNullable<FileQaIssueRecord['references']>[number]>;
  };
  type Category = { label: string; issues: FileQaIssueRecord[]; groups: Map<string, Group> };
  const categories = new Map<string, Category>();
  for (const issue of issues) {
    const definition = qaGroupForRule(issue.ruleId);
    const id = definition?.id ?? issue.ruleId;
    const category: Category = categories.get(id) ?? {
      label: definition?.label ?? 'Other checks',
      issues: [],
      groups: new Map(),
    };
    category.issues.push(issue);
    const groupId = issue.groupId ?? issue.ruleId;
    const group: Group = category.groups.get(groupId) ?? {
      label:
        issue.groupLabel ??
        definition?.checks.find((check) => check[0] === issue.ruleId)?.[1] ??
        issue.ruleId,
      issues: [],
      rows: new Map(),
      references: new Map(),
    };
    group.issues.push(issue);
    const row = group.rows.get(issue.segmentId) ?? [];
    row.push(issue);
    group.rows.set(issue.segmentId, row);
    for (const reference of issue.references ?? [])
      group.references.set(reference.segmentId, reference);
    category.groups.set(groupId, group);
    categories.set(id, category);
  }
  return [...categories.entries()].sort(
    ([left], [right]) =>
      (QA_GROUP_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (QA_GROUP_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export interface QaIssueRow {
  segmentId: string;
  row: number;
  issues: FileQaIssueRecord[];
  categories: ReturnType<typeof groupQaIssues>;
}

export function groupQaIssuesByRow(issues: FileQaIssueRecord[]): QaIssueRow[] {
  const rows = new Map<string, Omit<QaIssueRow, 'categories'>>();
  for (const issue of issues) {
    const row = rows.get(issue.segmentId) ?? {
      segmentId: issue.segmentId,
      row: issue.row,
      issues: [],
    };
    row.issues.push(issue);
    rows.set(issue.segmentId, row);
  }
  return [...rows.values()]
    .sort((left, right) => left.row - right.row)
    .map((row) => ({ ...row, categories: groupQaIssues(row.issues) }));
}
