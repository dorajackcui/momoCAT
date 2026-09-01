import { EditorMatchMode } from '../editorFilterUtils';

export type EditorCommand =
  | { type: 'confirm' }
  | { type: 'insertTag'; tagIndex: number }
  | { type: 'insertAllTags' }
  | { type: 'copySourceToTarget' };

export type EditorShortcutAction =
  | { type: 'confirm' }
  | { type: 'insertAllTags' }
  | { type: 'insertTag'; tagIndex: number }
  | null;

export interface EditorEngineSnapshot {
  text: string;
  selectionFrom: number;
  selectionTo: number;
  focused: boolean;
}

export interface EditorEngineOptions {
  editable: boolean;
  showNonPrintingSymbols: boolean;
  highlightQuery: string;
  highlightMode: EditorMatchMode;
}

export interface EditorEngineCallbacks {
  onTextChange: (nextText: string) => void;
  onFocusChange: (focused: boolean) => void;
  onShortcutAction: (action: EditorShortcutAction) => void;
}

export interface EditorEngineSelection {
  anchor: number;
  head: number;
}

export interface EditorEngineAdapter {
  mount(container: HTMLElement, initialText: string): void;
  unmount(): void;
  setText(nextText: string, preserveSelection: boolean): void;
  setEditable(editable: boolean): void;
  setOptions(options: Partial<EditorEngineOptions>): void;
  focus(caretCoords?: { x: number; y: number }, selection?: EditorEngineSelection): void;
  replaceSelection(insertText: string): void;
  dispatchCommand(command: EditorCommand): boolean;
  getSnapshot(): EditorEngineSnapshot;
  destroy(): void;
}
