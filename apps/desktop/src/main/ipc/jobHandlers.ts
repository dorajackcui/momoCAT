import type { JobManager } from '../JobManager';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { IpcMainLike } from './types';

export interface JobHandlerDeps {
  ipcMain: IpcMainLike;
  jobManager: JobManager;
}

export function registerJobHandlers({ ipcMain, jobManager }: JobHandlerDeps): void {
  // Lets a late subscriber (e.g. a progress modal opened after the job was
  // already kicked off) replay the last known state instead of waiting for an
  // event that may have already fired.
  registerHandle({ ipcMain }, IPC_CHANNELS.job.getStatus, (_event, ...args) => {
    const [jobId] = args as [string];
    return jobManager.getJob(jobId) ?? null;
  });
}
