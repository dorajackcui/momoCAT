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

    expect(Object.prototype.hasOwnProperty.call(api, 'testAIProvider')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(api, 'setAIKey')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(api, 'clearAIKey')).toBe(false);

    await api.listProjects();
    await api.listTMs();
    await api.getTMPreview('tm-1');
    await api.listTBs();
    await api.getTBPreview('tb-1');
    await api.getAISettings();
    await api.listAIConnections();
    await api.listAIProviders();
    await api.testAIConnection({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
    });
    await api.addAIProvider({
      name: 'OpenAI / gpt-demo',
      connectionId: 'connection:demo',
      model: 'gpt-demo',
    });
    await api.deleteAIConnection('connection:demo');
    await api.deleteAIProvider('custom:demo');
    await api.getProxySettings();
    await api.setProxySettings({ mode: 'off' });
    await api.aiTranslateSegment('seg-1');
    await api.aiRefineSegment('seg-1', 'tone down');
    await api.aiCancelFileJob('job-1');
    await api.openFileDialog([]);
    await api.readClipboard();
    await api.runFileQA(1);
    await api.inspectFile(1, 'inspect.xlsx');
    await api.exportReferencesForMt(1, 'references.xlsx');
    await api.checkForUpdates();
    await api.createPastedSourceFile(12, {
      sources: ['A', 'BB'],
      tagPolicy: 'default',
    });

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.project.list);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tm.list, undefined);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tm.preview, 'tm-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tb.list);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.tb.preview, 'tb-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.getSettings);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.listConnections);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.listProviders);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.testConnection, {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.addProvider, {
      name: 'OpenAI / gpt-demo',
      connectionId: 'connection:demo',
      model: 'gpt-demo',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.deleteConnection, 'connection:demo');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.deleteProvider, 'custom:demo');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.getProxySettings);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.setProxySettings, { mode: 'off' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.translateSegment, 'seg-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.refineSegment, 'seg-1', 'tone down');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.cancelFileJob, 'job-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dialog.openFile, []);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.clipboard.read);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.file.runQA, 1);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.file.inspect, 1, 'inspect.xlsx');
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.file.exportReferences,
      1,
      'references.xlsx',
    );
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.app.checkForUpdates);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.project.createPastedSourceFile, 12, {
      sources: ['A', 'BB'],
      tagPolicy: 'default',
    });
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
    const unsubscribeAppUpdate = api.onAppUpdateStatus(callback);
    const listeners = listenerStore.get(IPC_CHANNELS.events.appProgress) ?? [];
    const appUpdateListeners = listenerStore.get(IPC_CHANNELS.events.appUpdateStatus) ?? [];
    expect(listeners).toHaveLength(1);
    expect(appUpdateListeners).toHaveLength(1);

    listeners[0]({} as IpcRendererEvent, { type: 'x', current: 1, total: 1 });
    appUpdateListeners[0]({} as IpcRendererEvent, {
      phase: 'checking',
      message: 'Checking for updates...',
    });
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    unsubscribeAppUpdate();
    expect(removeListener).toHaveBeenCalledTimes(2);
  });
});
