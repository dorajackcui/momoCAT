import { useId, useMemo, useState } from 'react';
import type { EditorSegmentStore } from '../../hooks/editor/editorSegmentStore';
import type { FileQaIssueRecord } from '@cat/core/project';
import { QAResultRow } from './QAResultRow';
import { Button, Icon, IconButton } from '../ui';
import { QAVirtualList } from './QAVirtualList';
import { QAReferenceSummary } from './QAReferenceSummary';
import { groupQaIssues, groupQaIssuesByRow } from './qaResultGroups';
import { QARowList } from './QARowList';
import { qaSelectionForIssues, type QaHighlightSelection } from '../qaHighlights';

export interface QAPanelProps {
  issues: FileQaIssueRecord[];
  running: boolean;
  checked: boolean;
  stale: boolean;
  hasResults?: boolean;
  segmentStore: Pick<EditorSegmentStore, 'getSegment' | 'subscribeSegment'>;
  onRun: () => void;
  onFilter: (ids: string[], label: string, selection?: QaHighlightSelection) => void;
  onLocate: (id: string) => void;
}

export const QA_DISPLAY_STORAGE_KEY = 'momocat.editor.qaDisplayMode';
type QaDisplayMode = 'type' | 'row';

function readQaDisplayMode(): QaDisplayMode {
  try {
    return localStorage.getItem(QA_DISPLAY_STORAGE_KEY) === 'row' ? 'row' : 'type';
  } catch {
    return 'type';
  }
}

const rowIds = (issues: FileQaIssueRecord[]) => [
  ...new Set(issues.map((issue) => issue.segmentId)),
];
const rowCount = (count: number) => `${count} ${count === 1 ? 'row' : 'rows'}`;

export function QAPanel({
  issues,
  running,
  checked,
  stale,
  hasResults = issues.length > 0,
  segmentStore,
  onRun,
  onFilter,
  onLocate,
}: QAPanelProps) {
  const [displayMode, setDisplayMode] = useState(readQaDisplayMode);
  const categories = useMemo(() => groupQaIssues(issues), [issues]);
  const rows = useMemo(
    () => (displayMode === 'row' ? groupQaIssuesByRow(issues) : []),
    [displayMode, issues],
  );
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(() => new Set());
  const changeDisplayMode = (next: QaDisplayMode) => {
    setDisplayMode(next);
    try {
      localStorage.setItem(QA_DISPLAY_STORAGE_KEY, next);
    } catch {
      // Storage failures must not block switching the current report.
    }
  };
  const toggleRow = (id: string) =>
    setCollapsedRows((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={displayMode === 'type' ? 'Show QA by row' : 'Show QA by type'}
              title={
                displayMode === 'type' ? 'By type · Switch to By row' : 'By row · Switch to By type'
              }
              onClick={() => changeDisplayMode(displayMode === 'type' ? 'row' : 'type')}
            >
              <Icon name="arrow-left-right" />
            </IconButton>
            <Button size="sm" onClick={onRun} loading={running}>
              Run QA
            </Button>
          </div>
        </div>
        {(running || stale || !checked) &&
          ((stale || (!checked && hasResults)) && !running ? (
            <p className="notice notice-warning" role="status">
              {stale ? 'Changed · Recheck needed' : 'Saved results · Recheck needed'}
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              {running ? 'Checking…' : 'Not checked this session'}
            </p>
          ))}
      </div>
      {displayMode === 'row' && issues.length > 0 ? (
        <QARowList
          rows={rows}
          collapsed={collapsedRows}
          onToggle={toggleRow}
          virtualized={issues.length > 500}
          onFilter={onFilter}
          onLocate={onLocate}
        />
      ) : issues.length > 500 ? (
        <QAVirtualList
          categories={categories}
          collapsed={collapsed}
          onToggle={toggleCategory}
          segmentStore={segmentStore}
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
                  onClick={() =>
                    onFilter(
                      rowIds(category.issues),
                      category.label,
                      qaSelectionForIssues(category.issues, 'category'),
                    )
                  }
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
                          onClick={() => onFilter(ids, label, qaSelectionForIssues(group.issues))}
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
                        {[...group.rows.entries()].map(([segmentId, rowIssues]) => (
                          <li key={segmentId} className="text-xs text-text-muted">
                            <QAResultRow
                              segmentId={segmentId}
                              issues={rowIssues}
                              segmentStore={segmentStore}
                              onLocate={() => {
                                onFilter(ids, label, qaSelectionForIssues(group.issues));
                                onLocate(segmentId);
                              }}
                            />
                          </li>
                        ))}
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
