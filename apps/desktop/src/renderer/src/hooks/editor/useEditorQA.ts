import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Segment } from '@cat/core/models';
import type { FileQaReport } from '@cat/core/project';
import type { EditorSegmentStore } from './editorSegmentStore';

interface QAResult {
  fileId: number;
  revision: number;
  stale: boolean;
  checked: boolean;
}

export function useEditorQA(fileId: number, store: EditorSegmentStore) {
  const [result, setResult] = useState<QAResult | null>(null);
  const pending = useRef<{ fileId: number; revision: number } | null>(null);
  const current = result?.fileId === fileId ? result : null;
  const { issues, hasResults } = useSyncExternalStore(store.subscribe, store.getQAResults);
  // Edits only flip validity once; unchanged findings never rebuild or rerender per keystroke.
  const stale = useSyncExternalStore(store.subscribe, () =>
    Boolean(current && (current.stale || current.revision !== store.getQARevision())),
  );
  const startRun = useCallback(() => {
    pending.current = { fileId, revision: store.getQARevision() };
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
        store.applyUpdates(updates);
      }
      setResult({ fileId, stale, revision, checked: true });
    },
    [fileId, store],
  );
  useEffect(() => {
    if (!current && hasResults) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Capture the loaded result's validity boundary.
      setResult({ fileId, revision: store.getQARevision(), stale: false, checked: false });
    }
  }, [current, fileId, store, hasResults]);
  const checked = current?.checked ?? false;
  return useMemo(
    () => ({ startRun, acceptReport, issues, hasResults, checked, stale }),
    [startRun, acceptReport, issues, hasResults, checked, stale],
  );
}
