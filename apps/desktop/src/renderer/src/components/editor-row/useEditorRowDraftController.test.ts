import { describe, expect, it, vi } from 'vitest';
import {
  setEditorTextSilently,
  shouldCompleteEditorBlur,
  shouldFinalizeEditorOnDeactivate,
} from './useEditorRowDraftController';

describe('editor row draft lifecycle', () => {
  it('does not leak suppression when external text arrives without a mounted adapter', () => {
    const suppressNextChange = { current: false };

    setEditorTextSilently({
      adapter: null,
      nextText: 'AI result',
      preserveSelection: true,
      suppressNextChange,
    });

    expect(suppressNextChange.current).toBe(false);
  });

  it('suppresses a synchronous programmatic editor change and then resets the guard', () => {
    const suppressNextChange = { current: false };
    const setText = vi.fn(() => {
      expect(suppressNextChange.current).toBe(true);
      suppressNextChange.current = false;
    });

    setEditorTextSilently({
      adapter: { setText },
      nextText: 'remote update',
      preserveSelection: true,
      suppressNextChange,
    });

    expect(setText).toHaveBeenCalledWith('remote update', true);
    expect(suppressNextChange.current).toBe(false);
  });

  it('requires explicit editing finalization when a focused active row deactivates', () => {
    expect(
      shouldFinalizeEditorOnDeactivate({
        wasActive: true,
        isActive: false,
        wasFocused: true,
      }),
    ).toBe(true);
    expect(
      shouldFinalizeEditorOnDeactivate({
        wasActive: true,
        isActive: false,
        wasFocused: false,
      }),
    ).toBe(false);
  });

  it('ignores a stale blur completion after a new focus session starts', () => {
    expect(
      shouldCompleteEditorBlur({
        blurEpoch: 1,
        currentFocusEpoch: 2,
        isFocused: true,
        isMounted: true,
      }),
    ).toBe(false);
    expect(
      shouldCompleteEditorBlur({
        blurEpoch: 2,
        currentFocusEpoch: 2,
        isFocused: false,
        isMounted: true,
      }),
    ).toBe(true);
  });
});
