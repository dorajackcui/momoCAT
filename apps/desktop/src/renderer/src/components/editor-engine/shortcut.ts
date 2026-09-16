import { EditorShortcutAction } from './types';

interface EditorShortcutKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function resolveEditorShortcutAction({
  key,
  code,
  ctrlKey,
  metaKey,
  shiftKey,
}: EditorShortcutKeyInput): EditorShortcutAction {
  if ((ctrlKey || metaKey) && key === 'Enter') {
    return { type: 'confirm' };
  }

  if (!(ctrlKey || metaKey) || !shiftKey) {
    return null;
  }

  if (code === 'Digit0' || code === 'Numpad0') {
    return { type: 'insertAllTags' };
  }

  const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (digitMatch) {
    return { type: 'insertTag', tagIndex: Number.parseInt(digitMatch[1], 10) - 1 };
  }

  return null;
}

export type { EditorShortcutKeyInput };
