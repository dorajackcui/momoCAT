import type { DesktopApi } from '../../shared/ipc';
import { createAIApi } from './aiApi';
import { createClipboardApi } from './clipboardApi';
import { createDialogApi } from './dialogApi';
import { createEventApi } from './eventApi';
import { createProjectApi } from './projectApi';
import { createTBApi } from './tbApi';
import { createTMApi } from './tmApi';
import type { IpcRendererLike } from './types';

export function createDesktopApi(ipcRenderer: IpcRendererLike): DesktopApi {
  return {
    ...createProjectApi(ipcRenderer),
    ...createTMApi(ipcRenderer),
    ...createTBApi(ipcRenderer),
    ...createAIApi(ipcRenderer),
    ...createDialogApi(ipcRenderer),
    ...createClipboardApi(ipcRenderer),
    ...createEventApi(ipcRenderer),
  };
}
