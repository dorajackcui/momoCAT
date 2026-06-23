import { describe, expect, it, vi } from 'vitest';
import { registerHandle } from './registerHandle';

describe('registerHandle', () => {
  it('removes an existing handler before registering the next one', () => {
    const removeHandler = vi.fn();
    const handle = vi.fn();
    const listener = vi.fn();

    registerHandle({ ipcMain: { removeHandler, handle } }, 'clipboard-read', listener);

    expect(removeHandler).toHaveBeenCalledWith('clipboard-read');
    expect(handle).toHaveBeenCalledWith('clipboard-read', listener);
    expect(removeHandler.mock.invocationCallOrder[0]).toBeLessThan(
      handle.mock.invocationCallOrder[0],
    );
  });
});
