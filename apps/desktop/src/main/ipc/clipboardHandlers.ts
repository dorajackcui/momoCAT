import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { ClipboardHandlerDeps, IpcMainInvokeEventLike } from './types';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const RENDERER_ENTRY_SUFFIX = '/renderer/index.html';

export function registerClipboardHandlers({ ipcMain, clipboard }: ClipboardHandlerDeps): void {
  registerHandle({ ipcMain }, IPC_CHANNELS.clipboard.read, (event) => {
    assertClipboardAccessAllowed(event);
    return {
      text: clipboard.readText() || '',
      html: clipboard.readHTML() || '',
    };
  });
}

function assertClipboardAccessAllowed(event: IpcMainInvokeEventLike): void {
  if (!isTrustedClipboardFrameUrl(event.senderFrame?.url)) {
    throw new Error('Clipboard access denied');
  }
}

function isTrustedClipboardFrameUrl(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;

  try {
    const url = new URL(frameUrl);
    if (url.protocol === 'file:') {
      return url.pathname.endsWith(RENDERER_ENTRY_SUFFIX);
    }
    const isLocalHttp =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOCALHOST_HOSTS.has(url.hostname);
    if (isLocalHttp) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
