import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerJobHandlers } from './jobHandlers';
import type { JobManager } from '../JobManager';
import type { IpcMainListener } from './types';

function createIpcMainStub() {
  const handlers = new Map<string, IpcMainListener>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: IpcMainListener) => {
      handlers.set(channel, listener);
    }),
  };
  return { handlers, ipcMain };
}

describe('job IPC handlers', () => {
  it('returns the last known job state for a known job', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const snapshot = { jobId: 'job-1', progress: 100, status: 'completed' };
    const jobManager = { getJob: vi.fn().mockReturnValue(snapshot) } as unknown as JobManager;

    registerJobHandlers({ ipcMain, jobManager });

    expect(handlers.get(IPC_CHANNELS.job.getStatus)?.({}, 'job-1')).toBe(snapshot);
    expect(jobManager.getJob).toHaveBeenCalledWith('job-1');
  });

  it('returns null for an unknown job', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const jobManager = { getJob: vi.fn().mockReturnValue(undefined) } as unknown as JobManager;

    registerJobHandlers({ ipcMain, jobManager });

    expect(handlers.get(IPC_CHANNELS.job.getStatus)?.({}, 'missing')).toBeNull();
  });
});
