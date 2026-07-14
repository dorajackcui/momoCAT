import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { IpcMainListener } from './types';
import { registerSystemHandlers } from './systemHandlers';

describe('registerSystemHandlers', () => {
  it('opens a local file through Electron shell', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const openPath = vi.fn().mockResolvedValue('');
    registerSystemHandlers({
      ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
      shell: { openPath },
    });

    const handler = handlers.get(IPC_CHANNELS.system.openPath);
    await expect(handler?.({}, 'D:\\references\\terms.xlsx')).resolves.toBeUndefined();
    expect(openPath).toHaveBeenCalledWith('D:\\references\\terms.xlsx');
  });

  it('rejects the request when the operating system cannot open the path', async () => {
    const handlers = new Map<string, IpcMainListener>();
    registerSystemHandlers({
      ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
      shell: { openPath: vi.fn().mockResolvedValue('File not found') },
    });

    const handler = handlers.get(IPC_CHANNELS.system.openPath);
    await expect(handler?.({}, 'D:\\missing.xlsx')).rejects.toThrow('File not found');
  });

  it('rejects paths outside the spreadsheet formats supported by TM/TB sync', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const openPath = vi.fn();
    registerSystemHandlers({
      ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
      shell: { openPath },
    });

    const handler = handlers.get(IPC_CHANNELS.system.openPath);
    await expect(handler?.({}, 'D:\\downloads\\installer.exe')).rejects.toThrow(
      'Unsupported linked file type',
    );
    expect(openPath).not.toHaveBeenCalled();
  });
});
