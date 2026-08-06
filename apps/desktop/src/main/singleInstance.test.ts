import { describe, expect, it, vi } from 'vitest';
import { focusPrimaryWindow, type FocusableWindow } from './singleInstance';

function createWindow(isMinimized: boolean) {
  const calls: string[] = [];
  const window: FocusableWindow = {
    isMinimized: vi.fn(() => isMinimized),
    restore: vi.fn(() => calls.push('restore')),
    show: vi.fn(() => calls.push('show')),
    focus: vi.fn(() => calls.push('focus')),
  };
  return { calls, window };
}

describe('focusPrimaryWindow', () => {
  it('does nothing before the primary window exists', () => {
    expect(() => focusPrimaryWindow([])).not.toThrow();
  });

  it('shows and focuses an existing window', () => {
    const { calls, window } = createWindow(false);

    focusPrimaryWindow([window]);

    expect(window.restore).not.toHaveBeenCalled();
    expect(calls).toEqual(['show', 'focus']);
  });

  it('restores a minimized window before focusing it', () => {
    const { calls, window } = createWindow(true);

    focusPrimaryWindow([window]);

    expect(calls).toEqual(['restore', 'show', 'focus']);
  });
});
