import type { DesktopApi, ImportOptions } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type ProjectApiKeys =
  | 'listProjects'
  | 'createProject'
  | 'deleteProject'
  | 'getProject'
  | 'updateProjectPrompt'
  | 'updateProjectAISettings'
  | 'updateProjectQASettings'
  | 'getProjectFiles'
  | 'getFile'
  | 'getFilePreview'
  | 'deleteFile'
  | 'addFileToProject'
  | 'getSegments'
  | 'exportFile'
  | 'runFileQA'
  | 'updateSegment';

export function createProjectApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<ProjectApiKeys> {
  return {
    listProjects: () =>
      ipcRenderer.invoke(IPC_CHANNELS.project.list) as ReturnType<DesktopApi['listProjects']>,
    createProject: (name, srcLang, tgtLang, projectType) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.project.create,
        name,
        srcLang,
        tgtLang,
        projectType,
      ) as ReturnType<DesktopApi['createProject']>,
    deleteProject: (projectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.project.remove, projectId) as ReturnType<
        DesktopApi['deleteProject']
      >,
    getProject: (projectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.project.get, projectId) as ReturnType<
        DesktopApi['getProject']
      >,
    updateProjectPrompt: (projectId, aiPrompt) =>
      ipcRenderer.invoke(IPC_CHANNELS.project.updatePrompt, projectId, aiPrompt) as ReturnType<
        DesktopApi['updateProjectPrompt']
      >,
    updateProjectAISettings: (projectId, aiPrompt, aiModel) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.project.updateAISettings,
        projectId,
        aiPrompt,
        aiModel,
      ) as ReturnType<DesktopApi['updateProjectAISettings']>,
    updateProjectQASettings: (projectId, qaSettings) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.project.updateQASettings,
        projectId,
        qaSettings,
      ) as ReturnType<DesktopApi['updateProjectQASettings']>,
    getProjectFiles: (projectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.project.getFiles, projectId) as ReturnType<
        DesktopApi['getProjectFiles']
      >,
    getFile: (fileId) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.get, fileId) as ReturnType<DesktopApi['getFile']>,
    getFilePreview: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.getPreview, filePath) as ReturnType<
        DesktopApi['getFilePreview']
      >,
    deleteFile: (fileId) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.remove, fileId) as ReturnType<DesktopApi['deleteFile']>,
    addFileToProject: (projectId, filePath, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.project.addFile, projectId, filePath, options) as ReturnType<
        DesktopApi['addFileToProject']
      >,
    getSegments: (fileId, offset, limit) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.getSegments, fileId, offset, limit) as ReturnType<
        DesktopApi['getSegments']
      >,
    exportFile: (fileId, outputPath, options, forceExport) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.file.export,
        fileId,
        outputPath,
        options as ImportOptions | undefined,
        forceExport,
      ) as ReturnType<DesktopApi['exportFile']>,
    runFileQA: (fileId) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.runQA, fileId) as ReturnType<DesktopApi['runFileQA']>,
    updateSegment: (segmentId, targetTokens, status, clientRequestId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.segment.update,
        segmentId,
        targetTokens,
        status,
        clientRequestId,
      ) as ReturnType<DesktopApi['updateSegment']>,
  };
}
