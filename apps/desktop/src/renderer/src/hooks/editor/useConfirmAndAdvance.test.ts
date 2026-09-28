// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfirmAndAdvance } from './useConfirmAndAdvance';

function setup(visibleIds = ['a', 'c']) {
  const confirm = vi.fn().mockResolvedValue(true);
  const activate = vi.fn();
  const inputs = { fileId: 1, visibleIds, activeId: 'a', confirm, activate };
  const hook = renderHook((props) => useConfirmAndAdvance(props), { initialProps: inputs });
  return { ...hook, inputs, confirm, activate };
}

describe('confirmation navigation', () => {
  it('skips hidden rows and follows the displayed sort order', async () => {
    const hook = setup(['c', 'a', 'b']);
    await act(async () => hook.result.current('a'));
    expect(hook.activate).toHaveBeenCalledWith('b');
    hook.activate.mockClear();
    hook.rerender({ ...hook.inputs, visibleIds: ['a', 'c'] });
    await act(async () => hook.result.current('a'));
    expect(hook.activate).toHaveBeenCalledWith('c');
  });

  it.each([['a'], ['c'], []])(
    'stays put without a visible successor (%j)',
    async (...visibleIds) => {
      const hook = setup(visibleIds);
      await act(async () => hook.result.current('a'));
      expect(hook.confirm).toHaveBeenCalledWith('a');
      expect(hook.activate).not.toHaveBeenCalled();
    },
  );

  it('does not navigate if confirmation or its draft flush fails', async () => {
    const hook = setup();
    hook.confirm.mockResolvedValue(false);
    await act(async () => hook.result.current('a'));
    expect(hook.activate).not.toHaveBeenCalled();
  });

  it.each(['file', 'row', 'filter', 'unmount'])(
    'does not steal focus after a %s change during saving',
    async (change) => {
      const hook = setup();
      let finish!: (ok: boolean) => void;
      hook.confirm.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = hook.result.current('a');
      });
      if (change === 'unmount') hook.unmount();
      else
        hook.rerender({
          ...hook.inputs,
          ...(change === 'file'
            ? { fileId: 2 }
            : change === 'row'
              ? { activeId: 'c' }
              : { visibleIds: ['a', 'b', 'c'] }),
        });
      await act(async () => {
        finish(true);
        await pending;
      });
      expect(hook.activate).not.toHaveBeenCalled();
    },
  );

  it('keeps a stable callback and advances after a status-only view refresh', async () => {
    const hook = setup();
    const callback = hook.result.current;
    let finish!: (ok: boolean) => void;
    hook.confirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = callback('a');
    });
    hook.rerender({ ...hook.inputs, visibleIds: ['a', 'c'] });
    expect(hook.result.current).toBe(callback);
    await act(async () => {
      finish(true);
      await pending;
    });
    expect(hook.activate).toHaveBeenCalledWith('c');
  });
});
