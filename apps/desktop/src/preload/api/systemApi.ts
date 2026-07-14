import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type SystemApiKeys = 'openLocalFile';

export function createSystemApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<SystemApiKeys> {
  return {
    openLocalFile: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.system.openPath, filePath) as ReturnType<
        DesktopApi['openLocalFile']
      >,
  };
}
