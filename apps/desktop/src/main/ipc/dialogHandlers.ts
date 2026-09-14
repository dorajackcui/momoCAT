import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { DialogHandlerDeps } from './types';
import { isString, readArgument } from './argumentValidation';
import { isDialogFileFilters } from './dialogPayloadValidation';

export function registerDialogHandlers({ ipcMain, dialog }: DialogHandlerDeps): void {
  registerHandle({ ipcMain, dialog }, IPC_CHANNELS.dialog.openFile, async (_event, ...args) => {
    const filters = readArgument(args[0], 'file filters', isDialogFileFilters);
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    });
    return canceled ? null : filePaths[0];
  });

  registerHandle({ ipcMain, dialog }, IPC_CHANNELS.dialog.saveFile, async (_event, ...args) => {
    const defaultPath = readArgument(args[0], 'defaultPath', isString);
    const filters = readArgument(args[1], 'file filters', isDialogFileFilters);
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters,
    });
    return canceled ? null : filePath;
  });
}
