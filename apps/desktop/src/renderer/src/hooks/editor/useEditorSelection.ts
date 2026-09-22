import { useCallback, useMemo, useState } from 'react';

export interface SegmentSelectionModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function useEditorSelection(fileId: number, visibleIds: string[], activeId: string | null) {
  const [selection, setSelection] = useState<{
    fileId: number;
    ids: Set<string> | null;
    anchor: string | null;
  }>({ fileId, ids: null, anchor: null });
  if (selection.fileId !== fileId) setSelection({ fileId, ids: null, anchor: null });
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const selectedIds = useMemo(() => {
    const ids = selection.fileId === fileId ? selection.ids : null;
    return new Set(
      ids === null
        ? activeId && visible.has(activeId)
          ? [activeId]
          : []
        : [...ids].filter((id) => visible.has(id)),
    );
  }, [activeId, fileId, selection, visible]);

  // Drop hidden IDs permanently before rendering, so clearing a filter never
  // reselects them and no effect can race the user's next selection.
  if (selection.fileId === fileId && selection.ids && selectedIds.size !== selection.ids.size) {
    setSelection({ ...selection, ids: selectedIds });
  }

  const selectSingle = useCallback(
    (id: string) => {
      setSelection({ fileId, ids: null, anchor: id });
    },
    [fileId],
  );

  const selectSegment = useCallback(
    (id: string, modifiers: SegmentSelectionModifiers) => {
      if (!visible.has(id)) return;
      const anchor =
        selection.anchor && visible.has(selection.anchor) ? selection.anchor : activeId;
      if (modifiers.shiftKey && anchor && visible.has(anchor)) {
        const start = visibleIds.indexOf(anchor);
        const end = visibleIds.indexOf(id);
        setSelection({
          fileId,
          anchor,
          ids: new Set(visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1)),
        });
      } else if (modifiers.ctrlKey || modifiers.metaKey) {
        const ids = new Set(selectedIds);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        setSelection({ fileId, anchor: id, ids });
      } else {
        setSelection({ fileId, anchor: id, ids: new Set([id]) });
      }
    },
    [activeId, fileId, selectedIds, selection.anchor, visible, visibleIds],
  );

  const selectAll = useCallback(() => {
    setSelection({ fileId, ids: new Set(visibleIds), anchor: visibleIds[0] ?? null });
  }, [fileId, visibleIds]);

  return { selectedIds, selectSingle, selectSegment, selectAll };
}
