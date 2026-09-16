export const VIRTUALIZED_LIST_FLAG_KEY = 'editor.virtualizedList';
// Three 24px action buttons, two 4px gaps, and 6px breathing room above and below.
export const EDITOR_ROW_MIN_HEIGHT = 92;
export const ESTIMATED_EDITOR_ROW_HEIGHT = EDITOR_ROW_MIN_HEIGHT;
const DEFAULT_INITIAL_EDITOR_LIST_ROWS = 10;

export function isVirtualizedEditorListEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(VIRTUALIZED_LIST_FLAG_KEY) !== '0';
}

export function getEditorVirtualizerInitialRect(viewportHeight?: number): {
  width: number;
  height: number;
} {
  const fallbackHeight = ESTIMATED_EDITOR_ROW_HEIGHT * DEFAULT_INITIAL_EDITOR_LIST_ROWS;
  const measuredHeight =
    typeof viewportHeight === 'number' && Number.isFinite(viewportHeight) ? viewportHeight : null;

  return {
    width: 0,
    height: Math.max(ESTIMATED_EDITOR_ROW_HEIGHT, measuredHeight ?? fallbackHeight),
  };
}
