// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';

vi.mock('../services/feedbackService', () => ({ feedbackService: { error: vi.fn() } }));

describe('workspace navigation', () => {
  it('keeps the editor mounted during save, blocks overlapping navigation, then opens the requested page', async () => {
    const { result } = renderHook(useWorkspaceNavigation);
    await act(async () => {
      await result.current.navigate({ kind: 'editor', projectId: 1, fileId: 2 });
    });
    let finishSave!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    result.current.registerGuard(save);
    let navigation!: Promise<boolean>;
    act(() => {
      navigation = result.current.navigate({ kind: 'tm' });
    });
    expect(result.current.view.kind).toBe('editor');
    expect(result.current.pending).toBe(true);
    await act(async () => {
      expect(await result.current.navigate({ kind: 'settings' })).toBe(false);
    });
    await act(async () => {
      finishSave(true);
      expect(await navigation).toBe(true);
    });
    expect(result.current.view.kind).toBe('tm');
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it.each([false, new Error('write failed')])(
    'keeps the current page and skips destructive actions when saving fails: %s',
    async (failure) => {
      const { result } = renderHook(useWorkspaceNavigation);
      await act(async () => {
        await result.current.navigate({ kind: 'editor', projectId: 1, fileId: 2 });
      });
      result.current.registerGuard(async () => {
        if (failure instanceof Error) throw failure;
        return failure;
      });
      const deleteProject = vi.fn(async () => ({ kind: 'home' as const }));
      await act(async () => {
        expect(await result.current.runGuarded(deleteProject)).toBe(false);
      });
      expect(deleteProject).not.toHaveBeenCalled();
      expect(result.current.view.kind).toBe('editor');
      expect(result.current.pending).toBe(false);
    },
  );

  it('preserves the page when a guarded operation is cancelled and allows retry', async () => {
    const { result } = renderHook(useWorkspaceNavigation);
    const guard = vi.fn(async () => true);
    const unregister = result.current.registerGuard(guard);
    await act(async () => {
      expect(await result.current.runGuarded(async () => null)).toBe(false);
    });
    expect(result.current.view.kind).toBe('home');
    unregister();
    await act(async () => {
      await result.current.navigate({ kind: 'tb' });
    });
    expect(result.current.view.kind).toBe('tb');
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('does not clear a newer guard when an older editor registration cleans up', async () => {
    const { result } = renderHook(useWorkspaceNavigation);
    const unregister = result.current.registerGuard(async () => true);
    result.current.registerGuard(async () => false);
    unregister();
    await act(async () => {
      expect(await result.current.navigate({ kind: 'tm' })).toBe(false);
    });
    expect(result.current.view.kind).toBe('home');
  });
});
