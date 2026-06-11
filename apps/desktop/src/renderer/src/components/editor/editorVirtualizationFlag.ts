export const VIRTUALIZED_LIST_FLAG_KEY = 'editor.virtualizedList';

export function isVirtualizedEditorListEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(VIRTUALIZED_LIST_FLAG_KEY) !== '0';
}
