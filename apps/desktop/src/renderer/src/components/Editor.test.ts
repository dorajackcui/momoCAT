import { describe, expect, it } from 'vitest';
import {
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
});
