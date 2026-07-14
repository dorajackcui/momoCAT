import { extname } from 'path';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { SystemHandlerDeps } from './types';

const SUPPORTED_LINKED_FILE_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

export function registerSystemHandlers({ ipcMain, shell }: SystemHandlerDeps): void {
  registerHandle({ ipcMain, shell }, IPC_CHANNELS.system.openPath, async (_event, ...args) => {
    const [filePath] = args;
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('A local file path is required.');
    }
    if (!SUPPORTED_LINKED_FILE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      throw new Error('Unsupported linked file type. Expected an XLSX, XLS, or CSV file.');
    }

    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      throw new Error(`Failed to open linked file: ${errorMessage}`);
    }
  });
}
