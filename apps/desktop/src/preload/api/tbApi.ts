import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type TBApiKeys =
  | 'getTermMatches'
  | 'prefetchTermMatches'
  | 'listTBs'
  | 'getTBPreview'
  | 'createTB'
  | 'deleteTB'
  | 'getProjectMountedTBs'
  | 'mountTBToProject'
  | 'unmountTBFromProject'
  | 'getTBImportPreview'
  | 'importTBEntries';

export function createTBApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<TBApiKeys> {
  return {
    getTermMatches: (projectId, segment) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.getMatches, projectId, segment) as ReturnType<
        DesktopApi['getTermMatches']
      >,
    prefetchTermMatches: (projectId, segment) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.prefetch, projectId, segment) as ReturnType<
        DesktopApi['prefetchTermMatches']
      >,
    listTBs: () => ipcRenderer.invoke(IPC_CHANNELS.tb.list) as ReturnType<DesktopApi['listTBs']>,
    getTBPreview: (tbId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.preview, tbId) as ReturnType<
        DesktopApi['getTBPreview']
      >,
    createTB: (name, srcLang, tgtLang) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.create, name, srcLang, tgtLang) as ReturnType<
        DesktopApi['createTB']
      >,
    deleteTB: (tbId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.remove, tbId) as ReturnType<DesktopApi['deleteTB']>,
    getProjectMountedTBs: (projectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.getMountedByProject, projectId) as ReturnType<
        DesktopApi['getProjectMountedTBs']
      >,
    mountTBToProject: (projectId, tbId, priority) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.mount, projectId, tbId, priority) as ReturnType<
        DesktopApi['mountTBToProject']
      >,
    unmountTBFromProject: (projectId, tbId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.unmount, projectId, tbId) as ReturnType<
        DesktopApi['unmountTBFromProject']
      >,
    getTBImportPreview: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.importPreview, filePath) as ReturnType<
        DesktopApi['getTBImportPreview']
      >,
    importTBEntries: (tbId, filePath, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.tb.importExecute, tbId, filePath, options) as ReturnType<
        DesktopApi['importTBEntries']
      >,
  };
}
