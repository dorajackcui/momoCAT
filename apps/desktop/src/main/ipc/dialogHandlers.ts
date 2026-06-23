import type { DialogFileFilter } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { DialogHandlerDeps } from './types';

export function registerDialogHandlers({ ipcMain, dialog }: DialogHandlerDeps): void {
  registerHandle({ ipcMain, dialog }, IPC_CHANNELS.dialog.openFile, async (_event, ...args) => {
    const [filters] = args as [DialogFileFilter[]];
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    });
    return canceled ? null : filePaths[0];
  });

  registerHandle({ ipcMain, dialog }, IPC_CHANNELS.dialog.saveFile, async (_event, ...args) => {
    const [defaultPath, filters] = args as [string, DialogFileFilter[]];
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters,
    });
    return canceled ? null : filePath;
  });
}
