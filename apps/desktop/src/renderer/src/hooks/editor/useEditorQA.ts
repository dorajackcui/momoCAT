import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@cat/core/models';
import type { FileQaReport } from '@cat/core/project';
import type { EditorSegmentChange, EditorSegmentStore } from './editorSegmentStore';
import type { SegmentChangeHint } from './editorSegmentState';

interface QAResult {
  fileId: number;
  revision: number;
  stale: boolean;
  checked: boolean;
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
        checked: true,
      });
    },
    [fileId, store, publishChanges],
  );

  const { issues, hasResults } = useMemo(
    () => {
      const segments = store.getSegments().filter((segment) => segment.fileId === fileId);
      return {
        hasResults: segments.some((segment) => segment.qaIssues !== undefined),
        issues: segments.flatMap((segment) =>
          (segment.qaIssues ?? []).map((issue) => ({
            ...issue,
            segmentId: segment.segmentId,
            row: segment.meta?.rowRef ?? segment.orderIndex + 1,
          })),
        ),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The mutable store is refreshed by its change hint.
    [current, fileId, store, change],
  );

  useEffect(() => {
    if (!current) {
      if (hasResults) {
        // Loaded results are unverified, but edits after loading must still mark them stale.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Capture the loaded external store revision.
        setResult({ fileId, revision: store.getQARevision(), stale: false, checked: false });
      }
      return;
    }
    if (!current.stale && current.revision !== store.getQARevision())
      setResult({ ...current, stale: true });
  }, [current, fileId, store, change, hasResults]);

  return {
    startRun,
    acceptReport,
    issues,
    hasResults,
    checked: current?.checked ?? false,
    stale: current?.stale ?? false,
  };
}
