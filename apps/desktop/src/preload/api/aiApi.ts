import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type AIApiKeys =
  | 'getAISettings'
  | 'setAIKey'
  | 'clearAIKey'
  | 'listAIProviders'
  | 'testAIProvider'
  | 'addAIProvider'
  | 'deleteAIProvider'
  | 'getProxySettings'
  | 'setProxySettings'
  | 'testAIConnection'
  | 'aiTranslateSegment'
  | 'aiRefineSegment'
  | 'aiTranslateFile'
  | 'aiTestTranslate';

export function createAIApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<AIApiKeys> {
  return {
    getAISettings: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.getSettings) as ReturnType<DesktopApi['getAISettings']>,
    setAIKey: (apiKey) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.setKey, apiKey) as ReturnType<DesktopApi['setAIKey']>,
    clearAIKey: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.clearKey) as ReturnType<DesktopApi['clearAIKey']>,
    listAIProviders: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.listProviders) as ReturnType<DesktopApi['listAIProviders']>,
    testAIProvider: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.testProvider, input) as ReturnType<
        DesktopApi['testAIProvider']
      >,
    addAIProvider: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.addProvider, input) as ReturnType<
        DesktopApi['addAIProvider']
      >,
    deleteAIProvider: (providerId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.deleteProvider, providerId) as ReturnType<
        DesktopApi['deleteAIProvider']
      >,
    getProxySettings: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.getProxySettings) as ReturnType<
        DesktopApi['getProxySettings']
      >,
    setProxySettings: (settings) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.setProxySettings, settings) as ReturnType<
        DesktopApi['setProxySettings']
      >,
    testAIConnection: (apiKey) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.testConnection, apiKey) as ReturnType<
        DesktopApi['testAIConnection']
      >,
    aiTranslateSegment: (segmentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.translateSegment, segmentId) as ReturnType<
        DesktopApi['aiTranslateSegment']
      >,
    aiRefineSegment: (segmentId, instruction) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.refineSegment, segmentId, instruction) as ReturnType<
        DesktopApi['aiRefineSegment']
      >,
    aiTranslateFile: (fileId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.translateFile, fileId, options) as ReturnType<
        DesktopApi['aiTranslateFile']
      >,
    aiTestTranslate: (projectId, sourceText, contextText) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.ai.testTranslate,
        projectId,
        sourceText,
        contextText,
      ) as ReturnType<DesktopApi['aiTestTranslate']>,
  };
}
