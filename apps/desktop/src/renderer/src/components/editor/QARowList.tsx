import { useId, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileQaIssueRecord } from '@cat/core/project';
import type { QAPanelProps } from './QAPanel';
import type { QaIssueRow } from './qaResultGroups';
import { qaSelectionForIssues } from '../qaHighlights';
import { Button, Icon, IconButton } from '../ui';
import { QAReferenceSummary } from './QAReferenceSummary';

interface Props extends Pick<QAPanelProps, 'onFilter' | 'onLocate'> {
  rows: QaIssueRow[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  virtualized: boolean;
}

function QARowSection({
  row,
  collapsed,
  onToggle,
  onFilter,
  onLocate,
}: Omit<Props, 'rows' | 'virtualized'> & { row: QaIssueRow }) {
  const contentId = useId();
  const label = 'Row ' + row.row;
  const isCollapsed = collapsed.has(row.segmentId);
  const select = (issues: FileQaIssueRecord[], filterLabel: string) => {
    onFilter([row.segmentId], filterLabel, qaSelectionForIssues(issues));
    onLocate(row.segmentId);
  };
  return (
    <section aria-label={label}>
      <div className="flex items-center gap-1 border-b border-border-subtle bg-muted py-1 pr-2">
        <IconButton
          variant="ghost"
          size="xs"
          aria-label={(isCollapsed ? 'Expand ' : 'Collapse ') + label}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={() => onToggle(row.segmentId)}
        >
          <Icon name="chevron-down" className={'h-3 w-3 ' + (isCollapsed ? '-rotate-90' : '')} />
        </IconButton>
        <Button
          variant="link"
          className="min-w-0 flex-1 justify-between gap-3 text-left"
          aria-label={
            label + ' · ' + row.issues.length + (row.issues.length === 1 ? ' finding' : ' findings')
          }
          onClick={() => select(row.issues, label)}
        >
          <span className="text-sm font-semibold">{label}</span>
          <span className="shrink-0 text-xs font-normal text-text-muted">{row.issues.length}</span>
        </Button>
      </div>
      <div
        id={contentId}
        hidden={isCollapsed}
        className="divide-y divide-border-subtle pt-1 pr-2 pl-2"
      >
        {row.categories.map(([id, category]) => (
          <div
            key={id}
            className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-start gap-x-3 py-1"
          >
            <p className="break-words pt-1 text-xs text-text-muted">{category.label}</p>
            <div className="min-w-0">
              {[...category.groups.entries()].map(([key, group]) => {
                const filterLabel = label + ' › ' + category.label + ' › ' + group.label;
                const origins = [...new Set(group.issues.flatMap((issue) => issue.origins ?? []))];
                const messages = new Map<string, FileQaIssueRecord[]>();
                for (const issue of group.issues) {
                  const messageKey = issue.ruleId + '\0' + issue.message;
                  const matching = messages.get(messageKey) ?? [];
                  matching.push(issue);
                  messages.set(messageKey, matching);
                }
                return (
                  <div key={key}>
                    {[...messages.entries()].map(([messageKey, matching]) => (
                      <div key={messageKey} className="py-1 text-xs text-text-muted">
                        <Button
                          variant="link"
                          tone="inherit"
                          className="w-full justify-start text-left"
                          title={[
                            matching[0].groupId ? group.label : '',
                            matching[0].message,
                            origins.length ? 'Sources: ' + origins.join(', ') : '',
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          onClick={() => select(matching, filterLabel)}
                        >
                          <span className="min-w-0 truncate">
                            {matching[0].message || group.label}
                          </span>
                        </Button>
                      </div>
                    ))}
                    <QAReferenceSummary
                      references={[...group.references.values()]}
                      ids={[row.segmentId]}
                      label={filterLabel}
                      onFilter={onFilter}
                      onLocate={onLocate}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Grouping retains the complete report; row sections show findings without repeating CAT text. */
export function QARowList({ rows, virtualized, ...props }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => rows[index].segmentId,
    estimateSize: () => 180,
    overscan: 6,
  });
  return (
    <div ref={viewport} className="min-h-0 flex-1 overflow-auto p-3" aria-label="QA results by row">
      {virtualized ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-5"
              style={{ transform: 'translateY(' + item.start + 'px)' }}
            >
              <QARowSection row={rows[item.index]} {...props} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {rows.map((row) => (
            <QARowSection key={row.segmentId} row={row} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}
