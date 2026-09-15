// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateStatusEvent } from '../../../shared/ipc';
import { feedbackService } from '../services/feedbackService';
import { useAppUpdates } from './useAppUpdates';

const api = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  onAppUpdateStatus: vi.fn(),
}));
vi.mock('../services/apiClient', () => ({ apiClient: api }));
vi.mock('../services/feedbackService', () => ({
  feedbackService: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe('app updates', () => {
  let emit: (status: AppUpdateStatusEvent) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    api.checkForUpdates.mockResolvedValue(undefined);
    api.onAppUpdateStatus.mockImplementation((listener) => {
      emit = listener;
      return unsubscribe;
    });
  });

  it('subscribes once, tracks automatic checks quietly, and releases the subscription', () => {
    const { result, rerender, unmount } = renderHook(useAppUpdates);
    act(() => emit({ phase: 'checking', message: 'Checking automatically' }));
    expect(result.current.isBusy).toBe(true);
    act(() => emit({ phase: 'not-available', message: 'Already up to date' }));
    expect(result.current.statusMessage).toBe('Already up to date');
    expect(result.current.isBusy).toBe(false);
    expect(feedbackService.info).not.toHaveBeenCalled();
    rerender();
    expect(api.onAppUpdateStatus).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate checks and stays busy until a terminal status arrives', async () => {
    const { result } = renderHook(useAppUpdates);
    await act(async () => {
      await Promise.all([result.current.checkForUpdates(), result.current.checkForUpdates()]);
    });
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(result.current.isBusy).toBe(true);
    act(() => emit({ phase: 'not-available', message: 'Already up to date' }));
    expect(result.current.isBusy).toBe(false);
    expect(feedbackService.info).toHaveBeenCalledWith('Already up to date');
    await act(() => result.current.checkForUpdates());
    expect(api.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('limits manual progress notifications and always reports completion or errors', async () => {
    const { result } = renderHook(useAppUpdates);
    await act(() => result.current.checkForUpdates());
    act(() => {
      emit({ phase: 'available', message: 'Update found' });
      for (const percent of [1, 2, 24, 25, 26])
        emit({ phase: 'downloading', message: `Downloading ${percent}%`, percent });
    });
    expect(result.current.statusMessage).toBe('Downloading 26%');
    expect(result.current.isBusy).toBe(true);
    expect(feedbackService.info).toHaveBeenCalledTimes(3);
    act(() => emit({ phase: 'downloaded', message: 'Ready to restart' }));
    expect(feedbackService.success).toHaveBeenCalledWith('Ready to restart');
    expect(result.current.isBusy).toBe(false);
    act(() => emit({ phase: 'error', message: 'Automatic update failed' }));
    expect(feedbackService.error).toHaveBeenCalledWith('Automatic update failed');
  });

  it('shows a failed request and permits retry', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.checkForUpdates.mockRejectedValueOnce(new Error('IPC unavailable'));
    const { result } = renderHook(useAppUpdates);
    await act(() => result.current.checkForUpdates());
    expect(result.current.isBusy).toBe(false);
    expect(result.current.statusMessage).toBe('Failed to start update check.');
    expect(feedbackService.error).toHaveBeenCalledWith('Failed to start update check.');
    await act(() => result.current.checkForUpdates());
    expect(api.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.isBusy).toBe(true);
    errorLog.mockRestore();
  });
});
