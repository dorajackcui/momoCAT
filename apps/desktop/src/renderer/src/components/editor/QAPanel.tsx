import { useId, useMemo, useState } from 'react';
import type { Segment } from '@cat/core/models';
import { qaGroupForRule, type FileQaIssueRecord } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { Button, Icon, IconButton } from '../ui';
import { QAVirtualList } from './QAVirtualList';
import { QAReferenceSummary } from './QAReferenceSummary';
import { QA_GROUP_ORDER } from '../qaSections';

export interface QAPanelProps {
  issues: FileQaIssueRecord[];
  running: boolean;
  checked: boolean;
  stale: boolean;
  getSegment: (id: string) => Segment | undefined;
  onRun: () => void;
  onFilter: (ids: string[], label: string) => void;
  onLocate: (id: string) => void;
}

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

const rowIds = (issues: FileQaIssueRecord[]) => [
  ...new Set(issues.map((issue) => issue.segmentId)),
];
const rowCount = (count: number) => `${count} ${count === 1 ? 'row' : 'rows'}`;

function rowPreview(issues: FileQaIssueRecord[], segment?: Segment): string {
  const issue = issues[0];
  if (!issue.groupId || !segment)
    return [...new Set(issues.map((item) => item.message))].join('; ');
  const source = issue.ruleId === 'target-consistency';
  const text = serializeTokensToDisplayText(source ? segment.sourceTokens : segment.targetTokens);
  return text.trim() ? text : source ? '[Empty source]' : '[Empty target]';
}

export function QAPanel({
  issues,
  running,
  checked,
  stale,
  getSegment,
  onRun,
  onFilter,
  onLocate,
}: QAPanelProps) {
  const categories = useMemo(() => groupQaIssues(issues), [issues]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const panelId = useId();
  const toggleCategory = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border-subtle p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm" role="status">
            {issues.length} {issues.length === 1 ? 'finding' : 'findings'} ·{' '}
            {rowCount(rowIds(issues).length)}
          </span>
          <Button size="sm" onClick={onRun} loading={running}>
            Run QA
          </Button>
        </div>
        {(running || stale || !checked) &&
          (stale && !running ? (
            <p className="notice notice-warning">Changed · Recheck needed</p>
          ) : (
            <p className="text-xs text-text-muted">
              {running ? 'Checking…' : 'Not checked this session'}
            </p>
          ))}
      </div>
      {issues.length > 500 ? (
        <QAVirtualList
          categories={categories}
          collapsed={collapsed}
          onToggle={toggleCategory}
          getSegment={getSegment}
          onFilter={onFilter}
          onLocate={onLocate}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3 space-y-5">
          {checked && !running && !stale && issues.length === 0 && (
            <p className="text-sm text-text-muted">No QA problems found.</p>
          )}
          {categories.map(([id, category]) => (
            <section key={id} aria-label={category.label}>
              <div className="flex items-center gap-1 border-b border-border-subtle bg-muted py-1 pr-2">
                <IconButton
                  variant="ghost"
                  size="xs"
                  aria-label={`${collapsed.has(id) ? 'Expand' : 'Collapse'} ${category.label}`}
                  aria-expanded={!collapsed.has(id)}
                  aria-controls={`${panelId}-${id}`}
                  onClick={() => toggleCategory(id)}
                >
                  <Icon
                    name="chevron-down"
                    className={`h-3 w-3 ${collapsed.has(id) ? '-rotate-90' : ''}`}
                  />
                </IconButton>
                <Button
                  variant="link"
                  tone="inherit"
                  className="min-w-0 flex-1 justify-between gap-3 whitespace-normal text-left"
                  aria-label={`${category.label} · ${rowCount(rowIds(category.issues).length)}`}
                  onClick={() => onFilter(rowIds(category.issues), category.label)}
                >
                  <span className="min-w-0 break-words text-sm font-semibold">
                    {category.label}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs font-normal text-text-muted">
                    {rowIds(category.issues).length}
                  </span>
                </Button>
              </div>
              <div
                id={`${panelId}-${id}`}
                hidden={collapsed.has(id)}
                className="divide-y divide-border-subtle"
              >
                {[...category.groups.entries()].map(([key, group]) => {
                  const ids = [...group.rows.keys()];
                  const label = `${category.label} › ${group.label}`;
                  const origins = [
                    ...new Set(group.issues.flatMap((issue) => issue.origins ?? [])),
                  ];
                  return (
                    <div key={key} className="space-y-1 py-3 pr-2">
                      {(category.groups.size > 1 || group.issues[0].groupId) && (
                        <Button
                          variant="link"
                          tone="inherit"
                          className="w-full justify-between gap-3 text-left"
                          aria-label={`${group.label} · ${rowCount(ids.length)}`}
                          title={[
                            group.label,
                            origins.length ? `Sources: ${origins.join(', ')}` : '',
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          onClick={() => onFilter(ids, label)}
                        >
                          <span className="min-w-0 truncate text-sm font-normal">
                            {group.label}
                          </span>
                          <span className="shrink-0 text-xs font-normal text-text-muted">
                            {ids.length}
                          </span>
                        </Button>
                      )}
                      <QAReferenceSummary
                        references={[...group.references.values()]}
                        ids={ids}
                        label={label}
                        onFilter={onFilter}
                        onLocate={onLocate}
                      />
                      <ul className="space-y-1 pl-2">
                        {[...group.rows.entries()].map(([segmentId, rowIssues]) => {
                          const preview = rowPreview(rowIssues, getSegment(segmentId));
                          return (
                            <li key={segmentId} className="text-xs text-text-muted">
                              <Button
                                variant="link"
                                tone="inherit"
                                className="w-full justify-start gap-2 text-left"
                                title={preview}
                                onClick={() => {
                                  onFilter(ids, label);
                                  onLocate(segmentId);
                                }}
                              >
                                <span className="shrink-0 py-1 text-brand">
                                  Row {rowIssues[0].row}
                                </span>
                                <span className="min-w-0 truncate">{preview}</span>
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
