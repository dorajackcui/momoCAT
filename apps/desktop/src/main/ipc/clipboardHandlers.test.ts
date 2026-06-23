import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerClipboardHandlers } from './clipboardHandlers';

function createIpcMainStub() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    removeHandler: vi.fn(),
  };

  return { handlers, ipcMain };
}

describe('clipboard handlers', () => {
  it('allows app renderer frames to read clipboard content', () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const clipboard = {
      readText: vi.fn().mockReturnValue('plain text'),
      readHTML: vi.fn().mockReturnValue('<table></table>'),
    };

    registerClipboardHandlers({ ipcMain, clipboard });

    const handler = handlers.get(IPC_CHANNELS.clipboard.read);
    expect(handler).toBeDefined();
    expect(
      handler?.({
        senderFrame: { url: 'file:///D:/cat/momocat/apps/desktop/out/renderer/index.html' },
      }),
    ).toEqual({
      text: 'plain text',
      html: '<table></table>',
    });
  });

  it('rejects clipboard reads from non-app frames', () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const clipboard = {
      readText: vi.fn().mockReturnValue('secret'),
      readHTML: vi.fn().mockReturnValue('<b>secret</b>'),
    };

    registerClipboardHandlers({ ipcMain, clipboard });

    const handler = handlers.get(IPC_CHANNELS.clipboard.read);
    expect(handler).toBeDefined();
    expect(() =>
      handler?.({
        senderFrame: { url: 'https://example.com/embedded.html' },
      }),
    ).toThrow('Clipboard access denied');
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.readHTML).not.toHaveBeenCalled();
  });

  it('rejects clipboard reads from unrelated local file frames', () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const clipboard = {
      readText: vi.fn().mockReturnValue('secret'),
      readHTML: vi.fn().mockReturnValue('<b>secret</b>'),
    };

    registerClipboardHandlers({ ipcMain, clipboard });

    const handler = handlers.get(IPC_CHANNELS.clipboard.read);
    expect(handler).toBeDefined();
    expect(() =>
      handler?.({
        senderFrame: { url: 'file:///C:/Users/yizhi003/Downloads/untrusted.html' },
      }),
    ).toThrow('Clipboard access denied');
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.readHTML).not.toHaveBeenCalled();
  });
});
