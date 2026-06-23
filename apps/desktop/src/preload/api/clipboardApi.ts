import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type ClipboardApiKeys = 'readClipboard';

export function createClipboardApi(
  ipcRenderer: IpcRendererLike,
): DesktopApiSlice<ClipboardApiKeys> {
  return {
    readClipboard: () =>
      ipcRenderer.invoke(IPC_CHANNELS.clipboard.read) as ReturnType<DesktopApi['readClipboard']>,
  };
}
