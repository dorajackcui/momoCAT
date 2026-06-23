import type { IpcMainLike, IpcMainListener } from './types';

export function registerHandle<TDeps extends { ipcMain: IpcMainLike }>(
  deps: TDeps,
  channel: string,
  listener: IpcMainListener,
): void {
  deps.ipcMain.removeHandler?.(channel);
  deps.ipcMain.handle(channel, listener);
}
