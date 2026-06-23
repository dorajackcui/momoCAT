import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ClipboardHandlerDeps } from './types';

function registerHandle(
  deps: ClipboardHandlerDeps,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown,
) {
  deps.ipcMain.removeHandler?.(channel);
  deps.ipcMain.handle(channel, listener);
}

export function registerClipboardHandlers({ ipcMain, clipboard }: ClipboardHandlerDeps): void {
  registerHandle({ ipcMain, clipboard }, IPC_CHANNELS.clipboard.read, () => ({
    text: clipboard.readText() || '',
    html: clipboard.readHTML() || '',
  }));
}
