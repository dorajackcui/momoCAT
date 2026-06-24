import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type AppApiKeys = 'checkForUpdates';

export function createAppApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<AppApiKeys> {
  return {
    checkForUpdates: () =>
      ipcRenderer.invoke(IPC_CHANNELS.app.checkForUpdates) as ReturnType<
        DesktopApi['checkForUpdates']
      >,
  };
}
