import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileQaIssueRecord } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { QAPanelProps, groupQaIssues } from './QAPanel';
import { Button, Icon, IconButton } from '../ui';

interface Props extends Pick<QAPanelProps, 'getSegment' | 'onFilter' | 'onLocate'> {
  categories: ReturnType<typeof groupQaIssues>;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

type Entry =
  | { kind: 'category'; key: string; id: string; label: string; ids: string[] }
  | { kind: 'group'; key: string; label: string; filterLabel: string; ids: string[]; title: string }
  | {
      kind: 'row';
      key: string;
      segmentId: string;
      issues: FileQaIssueRecord[];
      filterLabel: string;
      ids: string[];
    };

/** One scroll viewport for all categories: grouping and filtering always retain every row. */
export function QAVirtualList({
  categories,
  collapsed,
  onToggle,
  getSegment,
  onFilter,
  onLocate,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const result: Entry[] = [];
    for (const [id, category] of categories) {
      result.push({
        kind: 'category',
        key: id,
        id,
        label: category.label,
        ids: [...new Set(category.issues.map((issue) => issue.segmentId))],
      });
      if (collapsed.has(id)) continue;
      for (const [key, group] of category.groups) {
        const ids = [...group.rows.keys()];
        const filterLabel = `${category.label} › ${group.label}`;
        if (category.groups.size > 1 || group.issues[0].groupId) {
          const origins = [...new Set(group.issues.flatMap((issue) => issue.origins ?? []))];
          result.push({
            kind: 'group',
            key: `${id}/${key}`,
            label: group.label,
            filterLabel,
            ids,
            title: [group.label, origins.length ? `Sources: ${origins.join(', ')}` : '']
              .filter(Boolean)
              .join('\n'),
          });
        }
        for (const [segmentId, issues] of group.rows)
          result.push({
            kind: 'row',
            key: `${id}/${key}/${segmentId}`,
            segmentId,
            issues,
            filterLabel,
            ids,
          });
      }
    }
    return result;
  }, [categories, collapsed]);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => entries[index].key,
    estimateSize: () => 36,
    overscan: 8,
  });
  return (
    <div ref={viewport} className="min-h-0 flex-1 overflow-auto p-3" aria-label="QA results">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-1"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {entry.kind === 'category' ? (
                <div
                  role="region"
                  aria-label={entry.label}
                  className="flex items-center gap-1 border-b border-border-subtle bg-muted py-1 pr-2"
                >
                  <IconButton
                    variant="ghost"
                    size="xs"
                    aria-expanded={!collapsed.has(entry.id)}
                    aria-label={`${collapsed.has(entry.id) ? 'Expand' : 'Collapse'} ${entry.label}`}
                    onClick={() => onToggle(entry.id)}
                  >
                    <Icon
                      name="chevron-down"
                      className={`h-3 w-3 ${collapsed.has(entry.id) ? '-rotate-90' : ''}`}
                    />
                  </IconButton>
                  <Button
                    variant="link"
                    tone="inherit"
                    className="min-w-0 flex-1 justify-between gap-3 whitespace-normal text-left"
                    aria-label={`${entry.label} · ${entry.ids.length} rows`}
                    onClick={() => onFilter(entry.ids, entry.label)}
                  >
                    <span className="min-w-0 break-words text-sm font-semibold">{entry.label}</span>
                    <span className="shrink-0 text-xs font-normal text-text-muted">
                      {entry.ids.length}
                    </span>
                  </Button>
                </div>
              ) : entry.kind === 'group' ? (
                <div className="border-t border-border-subtle pt-2 pr-2">
                  <Button
                    variant="link"
                    tone="inherit"
                    className="w-full justify-between gap-3 text-left"
                    aria-label={`${entry.label} · ${entry.ids.length} rows`}
                    title={entry.title}
                    onClick={() => onFilter(entry.ids, entry.filterLabel)}
                  >
                    <span className="min-w-0 truncate text-sm font-normal">{entry.label}</span>
                    <span className="shrink-0 text-xs font-normal text-text-muted">
                      {entry.ids.length}
                    </span>
                  </Button>
                </div>
              ) : (
                (() => {
                  const issue = entry.issues[0];
                  const segment = getSegment(entry.segmentId);
                  const source = issue.ruleId === 'target-consistency';
                  const text = segment
                    ? serializeTokensToDisplayText(
                        source ? segment.sourceTokens : segment.targetTokens,
                      )
                    : '';
                  const preview =
                    issue.groupId && segment
                      ? text.trim()
                        ? text
                        : source
                          ? '[Empty source]'
                          : '[Empty target]'
                      : [...new Set(entry.issues.map((row) => row.message))].join('; ');
                  const references = new Map(
                    entry.issues.flatMap((row) =>
                      (row.references ?? []).map((ref) => [ref.segmentId, ref]),
                    ),
                  );
                  return (
                    <div className="pl-2 pr-2 text-xs text-text-muted">
                      <Button
                        variant="link"
                        tone="inherit"
                        className="w-full justify-start gap-2 text-left"
                        title={preview}
                        onClick={() => {
                          onFilter(entry.ids, entry.filterLabel);
                          onLocate(entry.segmentId);
                        }}
                      >
                        <span className="shrink-0 py-1 text-brand">Row {issue.row}</span>
                        <span className="min-w-0 truncate">{preview}</span>
                      </Button>
                      {[...references.values()].map((reference) => (
                        <Button
                          key={reference.segmentId}
                          variant="link"
                          className="mr-2"
                          onClick={() => {
                            onFilter(
                              [...new Set([...entry.ids, reference.segmentId])],
                              entry.filterLabel,
                            );
                            onLocate(reference.segmentId);
                          }}
                        >
                          Reference row {reference.row}
                        </Button>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
