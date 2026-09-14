import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerDialogHandlers } from './dialogHandlers';
import type { IpcMainListener } from './types';

function setup(canceled = false) {
  const handlers = new Map<string, IpcMainListener>();
  const dialog = {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled, filePaths: ['source.xlsx'] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled, filePath: 'output.xlsx' }),
  };
  registerDialogHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog,
  });
  return {
    dialog,
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args),
  };
}

describe('file dialog handlers', () => {
  it('forwards file filters unchanged and returns the selected file', async () => {
    const { invoke, dialog } = setup();
    const filters = [{ name: 'Excel', extensions: ['xlsx', 'xls'], extra: true }];
    await expect(invoke(IPC_CHANNELS.dialog.openFile, filters)).resolves.toBe('source.xlsx');
    expect(dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
      properties: ['openFile'],
      filters,
    });
    expect(dialog.showOpenDialog.mock.calls[0][0].filters).toBe(filters);
  });

  it('preserves an empty default path and an empty filter list for save dialogs', async () => {
    const { invoke, dialog } = setup();
    await expect(invoke(IPC_CHANNELS.dialog.saveFile, '', [])).resolves.toBe('output.xlsx');
    expect(dialog.showSaveDialog).toHaveBeenCalledExactlyOnceWith({ defaultPath: '', filters: [] });
  });

  it('returns null for cancelled open and save dialogs', async () => {
    const { invoke } = setup(true);
    await expect(invoke(IPC_CHANNELS.dialog.openFile, [])).resolves.toBeNull();
    await expect(invoke(IPC_CHANNELS.dialog.saveFile, 'output.xlsx', [])).resolves.toBeNull();
  });
});
