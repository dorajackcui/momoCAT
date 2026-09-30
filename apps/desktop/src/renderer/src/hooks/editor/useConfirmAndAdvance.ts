import { useCallback, useLayoutEffect, useRef } from 'react';

interface Params {
  fileId: number;
  visibleIds: readonly string[];
  activeId: string | null;
  confirm: (segmentId: string) => Promise<boolean>;
  activate: (segmentId: string) => void;
}

// Navigation follows the displayed order, while confirmation owns persistence.
export function useConfirmAndAdvance(inputs: Params) {
  const latest = useRef<Params | null>(inputs);
  useLayoutEffect(() => {
    latest.current = inputs;
    return () => {
      latest.current = null;
    };
  });

  // Keep the callback forwarded to every row stable as drafts and filters change.
  return useCallback(async (segmentId: string) => {
    const start = latest.current;
    if (!start) return;
    const index = start.visibleIds.indexOf(segmentId);
    const nextId = index >= 0 ? start.visibleIds[index + 1] : undefined;
    if (!(await start.confirm(segmentId))) return;

    const current = latest.current;
    if (!nextId || !current || current.fileId !== start.fileId || current.activeId !== segmentId)
      return;
    const currentIndex = current.visibleIds.indexOf(segmentId);
    if (currentIndex >= 0 && current.visibleIds[currentIndex + 1] === nextId) {
      current.activate(nextId);
    }
  }, []);
}
