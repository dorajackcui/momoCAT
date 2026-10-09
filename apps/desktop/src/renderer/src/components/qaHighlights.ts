import type { QaHighlight, QaIssue } from '@cat/core/models';
import { qaGroupForRule } from '@cat/core/project';

export interface QaHighlightSelection {
  ruleIds: string[];
  groupId?: string;
}

export function qaSelectionForIssues(
  issues: readonly QaIssue[],
  scope: 'category' | 'group' = 'group',
): QaHighlightSelection {
  if (scope === 'category') {
    const checks = qaGroupForRule(issues[0]?.ruleId ?? '')?.checks;
    return {
      ruleIds: checks
        ? checks.map(([id]) => id)
        : [...new Set(issues.map((issue) => issue.ruleId))],
    };
  }
  const groupId = issues[0]?.groupId;
  return {
    ruleIds: [...new Set(issues.map((issue) => issue.ruleId))],
    ...(groupId && issues.every((issue) => issue.groupId === groupId) ? { groupId } : {}),
  };
}

export function selectedQaHighlights(
  issues: readonly QaIssue[],
  selection: QaHighlightSelection | undefined,
  side: QaHighlight['side'],
): QaHighlight[] {
  if (!selection) return [];
  return issues
    .filter(
      (issue) =>
        selection.ruleIds.includes(issue.ruleId) &&
        (!selection.groupId || issue.groupId === selection.groupId),
    )
    .flatMap((issue) => issue.highlights ?? [])
    .filter((highlight) => highlight?.side === side);
}
