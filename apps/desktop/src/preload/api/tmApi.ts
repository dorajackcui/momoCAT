import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type TMApiKeys =
  | 'getMatches'
  | 'prefetchMatches'
  | 'searchConcordance'
  | 'listTMs'
  | 'getTMPreview'
  | 'createTM'
  | 'renameTM'
  | 'deleteTM'
  | 'getProjectMountedTMs'
  | 'mountTMToProject'
  | 'unmountTMFromProject'
  | 'commitToMainTM'
  | 'matchFileWithTM'
  | 'getTMImportPreview'
  | 'importTMEntries'
  | 'setTMSyncConfig'
  | 'syncTMWithExcel'
  | 'cancelTMSync';

export function createTMApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<TMApiKeys> {
  return {
    getMatches: (projectId, segment) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.getMatches, projectId, segment) as ReturnType<
        DesktopApi['getMatches']
      >,
    prefetchMatches: (projectId, segment) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.prefetch, projectId, segment) as ReturnType<
        DesktopApi['prefetchMatches']
      >,
    searchConcordance: (projectId, query) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.concordance, projectId, query) as ReturnType<
        DesktopApi['searchConcordance']
      >,
    listTMs: (type) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.list, type) as ReturnType<DesktopApi['listTMs']>,
    getTMPreview: (tmId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.preview, tmId) as ReturnType<DesktopApi['getTMPreview']>,
    createTM: (name, srcLang, tgtLang, type) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.create, name, srcLang, tgtLang, type) as ReturnType<
        DesktopApi['createTM']
      >,
    renameTM: (tmId, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.rename, tmId, name) as ReturnType<DesktopApi['renameTM']>,
    deleteTM: (tmId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.remove, tmId) as ReturnType<DesktopApi['deleteTM']>,
    getProjectMountedTMs: (projectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.getMountedByProject, projectId) as ReturnType<
        DesktopApi['getProjectMountedTMs']
      >,
    mountTMToProject: (projectId, tmId, priority, permission) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.tm.mount,
        projectId,
        tmId,
        priority,
        permission,
      ) as ReturnType<DesktopApi['mountTMToProject']>,
    unmountTMFromProject: (projectId, tmId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.unmount, projectId, tmId) as ReturnType<
        DesktopApi['unmountTMFromProject']
      >,
    commitToMainTM: (tmId, fileId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.commitFile, tmId, fileId, options) as ReturnType<
        DesktopApi['commitToMainTM']
      >,
    matchFileWithTM: (fileId, tmId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.matchFile, fileId, tmId) as ReturnType<
        DesktopApi['matchFileWithTM']
      >,
    getTMImportPreview: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.importPreview, filePath) as ReturnType<
        DesktopApi['getTMImportPreview']
      >,
    importTMEntries: (tmId, filePath, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.importExecute, tmId, filePath, options) as ReturnType<
        DesktopApi['importTMEntries']
      >,
    setTMSyncConfig: (tmId, config) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.syncSetConfig, tmId, config) as ReturnType<
        DesktopApi['setTMSyncConfig']
      >,
    syncTMWithExcel: (tmId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.syncExecute, tmId) as ReturnType<
        DesktopApi['syncTMWithExcel']
      >,
    cancelTMSync: (tmId, jobId) =>
      ipcRenderer.invoke(IPC_CHANNELS.tm.syncCancel, tmId, jobId) as ReturnType<
        DesktopApi['cancelTMSync']
      >,
  };
}
