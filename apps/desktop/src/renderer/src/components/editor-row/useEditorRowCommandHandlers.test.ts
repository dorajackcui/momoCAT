import { describe, expect, it } from 'vitest';
import { resolveEditorRowShortcutAction } from './useEditorRowCommandHandlers';

describe('useEditorRowCommandHandlers.resolveEditorRowShortcutAction', () => {
  it('returns null for unrelated shortcuts', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: 'a',
        code: 'KeyA',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull();

    expect(
      resolveEditorRowShortcutAction({
        key: '1',
        code: 'Digit1',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it('returns confirm for command/ctrl + enter', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({ type: 'confirm' });
  });

  it('returns insert all tags for command/ctrl + shift + the physical 0 key', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: '0',
        code: 'Digit0',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertAllTags' });

    expect(
      resolveEditorRowShortcutAction({
        key: ')',
        code: 'Digit0',
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertAllTags' });
  });

  it('returns insert tag for command/ctrl + shift + physical number keys', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: '!',
        code: 'Digit1',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertTag', tagIndex: 0 });

    expect(
      resolveEditorRowShortcutAction({
        key: '(',
        code: 'Digit9',
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertTag', tagIndex: 8 });

    expect(
      resolveEditorRowShortcutAction({
        key: '1',
        code: 'Numpad1',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertTag', tagIndex: 0 });
  });
});
