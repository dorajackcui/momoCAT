import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@cat/core/models';
import type { FileQaReport } from '@cat/core/project';
import type { EditorSegmentChange, EditorSegmentStore } from './editorSegmentStore';
import type { SegmentChangeHint } from './editorSegmentState';

interface QAResult {
  fileId: number;
  revision: number;
  stale: boolean;
}

export function useEditorQA(
  fileId: number,
  store: EditorSegmentStore,
  change: SegmentChangeHint,
  publishChanges: (changes: EditorSegmentChange[]) => void,
) {
  const [result, setResult] = useState<QAResult | null>(null);
  const pending = useRef<{ fileId: number; revision: number } | null>(null);
  const current = result?.fileId === fileId ? result : null;
  const startRun = useCallback(() => {
    pending.current = {
      fileId,
      revision: store.getQARevision(),
    };
  }, [fileId, store]);
  const acceptReport = useCallback(
    (report: FileQaReport) => {
      if (report.fileId !== fileId || pending.current?.fileId !== fileId) return;
      const { revision } = pending.current;
      pending.current = null;
      const stale = Boolean(report.stale) || store.getQARevision() !== revision;
      if (!stale) {
        const byRow = new Map<string, FileQaReport['issues']>();
        for (const issue of report.issues) {
          const row = byRow.get(issue.segmentId) ?? [];
          row.push(issue);
          byRow.set(issue.segmentId, row);
        }
        const updates = new Map<string, Segment>();
        for (const segment of store.getSegments()) {
          const qaIssues = byRow.get(segment.segmentId) ?? [];
          if (JSON.stringify(qaIssues) !== JSON.stringify(segment.qaIssues))
            updates.set(segment.segmentId, { ...segment, qaIssues });
        }
        publishChanges(store.applyUpdates(updates));
      }
      setResult({
        fileId,
        stale,
        revision,
      });
    },
    [fileId, store, publishChanges],
  );

  useEffect(() => {
    if (!current || current.stale) return;
    const changed = current.revision !== store.getQARevision();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The external segment store supplies per-row changes.
    if (changed) setResult({ ...current, stale: true });
  }, [current, store, change]);

  const issues = useMemo(
    () =>
      store.getSegments().flatMap((segment) =>
        (segment.qaIssues ?? []).map((issue) => ({
          ...issue,
          segmentId: segment.segmentId,
          row: segment.meta?.rowRef ?? segment.orderIndex + 1,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The mutable store is refreshed by its change hint.
    [current, store, change],
  );
  return {
    startRun,
    acceptReport,
    issues,
    checked: Boolean(current),
    stale: current?.stale ?? false,
  };
}
