import { describe, expect, it } from 'vitest';
import {
  ESTIMATED_EDITOR_ROW_HEIGHT,
  getEditorVirtualizerInitialRect,
  isVirtualizedEditorListEnabled,
  VIRTUALIZED_LIST_FLAG_KEY,
} from './editor/editorVirtualizationFlag';

describe('Editor virtualization flag', () => {
  it('enables virtualization by default unless explicitly disabled', () => {
    const enabledStorage = {
      getItem: (key: string) => (key === VIRTUALIZED_LIST_FLAG_KEY ? '1' : null),
    };
    const defaultStorage = {
      getItem: () => null,
    };
    const disabledStorage = {
      getItem: (key: string) => (key === VIRTUALIZED_LIST_FLAG_KEY ? '0' : null),
    };

    expect(isVirtualizedEditorListEnabled(enabledStorage)).toBe(true);
    expect(isVirtualizedEditorListEnabled(defaultStorage)).toBe(true);
    expect(isVirtualizedEditorListEnabled(disabledStorage)).toBe(false);
  });

  it('uses a positive initial virtualizer height before the scroll container is measured', () => {
    expect(getEditorVirtualizerInitialRect(0)).toEqual({
      width: 0,
      height: ESTIMATED_EDITOR_ROW_HEIGHT,
    });
    expect(getEditorVirtualizerInitialRect(undefined)).toEqual({
      width: 0,
      height: ESTIMATED_EDITOR_ROW_HEIGHT * 10,
    });
    expect(getEditorVirtualizerInitialRect(900)).toEqual({ width: 0, height: 900 });
  });
});
