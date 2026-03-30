import { describe, expect, it, vi } from 'vitest';
import type { IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { createDesktopApi } from './createDesktopApi';
import type { IpcRendererLike } from './types';

describe('createDesktopApi smoke', () => {
  it('maps core domain methods to expected IPC channels', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn();
    const removeListener = vi.fn();
    const ipcRenderer = { invoke, on, removeListener } as unknown as IpcRendererLike;
    const api = createDesktopApi(ipcRenderer);

    await api.listProjects();
    await api.listTMs();
    await api.listTBs();
    await api.getAISettings();
    await api.listAIProviders();
    await api.testAIProvider({
      name: 'Demo Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'gpt-demo',
    });
    await api.addAIProvider({
      name: 'Demo Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'gpt-demo',
    });
    await api.deleteAIProvider('custom:demo');
    await api.getProxySettings();
    await api.setProxySettings({ mode: 'off' });
    await api.aiTranslateSegment('seg-1');
    await api.aiRefineSegment('seg-1', 'tone down');
    await api.openFileDialog([]);
    await api.runFileQA(1);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.project.list);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tm.list, undefined);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tb.list);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.getSettings);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.listProviders);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.testProvider, {
      name: 'Demo Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'gpt-demo',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.addProvider, {
      name: 'Demo Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'gpt-demo',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.deleteProvider, 'custom:demo');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.getProxySettings);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.setProxySettings, { mode: 'off' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.translateSegment, 'seg-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.refineSegment, 'seg-1', 'tone down');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dialog.openFile, []);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.file.runQA, 1);
  });

  it('subscribes and unsubscribes event channels correctly', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const listenerStore = new Map<
      string,
      ((event: IpcRendererEvent, payload: unknown) => void)[]
    >();
    const on = vi.fn(
      (channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void) => {
        listenerStore.set(channel, [...(listenerStore.get(channel) ?? []), listener]);
      },
    );
    const removeListener = vi.fn(
      (channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void) => {
        const listeners = listenerStore.get(channel) ?? [];
        listenerStore.set(
          channel,
          listeners.filter((item) => item !== listener),
        );
      },
    );

    const api = createDesktopApi({
      invoke,
      on,
      removeListener,
    });

    const callback = vi.fn();
    const unsubscribe = api.onProgress(callback);
    const listeners = listenerStore.get(IPC_CHANNELS.events.appProgress) ?? [];
    expect(listeners).toHaveLength(1);

    listeners[0]({} as IpcRendererEvent, { type: 'x', current: 1, total: 1 });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
