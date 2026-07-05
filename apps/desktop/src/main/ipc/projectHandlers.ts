import type { ProjectQASettings, ProjectType } from '@cat/core/project';
import type { SegmentStatus, Token } from '@cat/core/models';
import type { ImportOptions, PastedSourceFileInput } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { MainHandlerDeps } from './types';

export function registerProjectHandlers({ ipcMain, projectService }: MainHandlerDeps): void {
  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.list, () =>
    projectService.listProjects(),
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.create, (_event, ...args) => {
    const [name, srcLang, tgtLang, projectType] = args as [
      string,
      string,
      string,
      ProjectType | undefined,
    ];
    return projectService.createProject(name, srcLang, tgtLang, projectType);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.get, (_event, ...args) => {
    const [projectId] = args as [number];
    return projectService.getProject(projectId);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updatePrompt,
    (_event, ...args) => {
      const [projectId, aiPrompt] = args as [number, string | null];
      return projectService.updateProjectPrompt(projectId, aiPrompt);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateAISettings,
    (_event, ...args) => {
      const [projectId, aiPrompt, aiProviderId] = args as [number, string | null, string | null];
      return projectService.updateProjectAISettings(projectId, aiPrompt, aiProviderId);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateQASettings,
    (_event, ...args) => {
      const [projectId, qaSettings] = args as [number, ProjectQASettings];
      return projectService.updateProjectQASettings(projectId, qaSettings);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.listSavedPrompts,
    (_event, ...args) => {
      const [projectId] = args as [number];
      return projectService.listProjectSavedPrompts(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.createSavedPrompt,
    (_event, ...args) => {
      const [projectId, name, content] = args as [number, string, string];
      return projectService.createProjectSavedPrompt(projectId, name, content);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateSavedPromptContent,
    (_event, ...args) => {
      const [promptId, content] = args as [number, string];
      return projectService.updateProjectSavedPromptContent(promptId, content);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.renameSavedPrompt,
    (_event, ...args) => {
      const [promptId, name] = args as [number, string];
      return projectService.renameProjectSavedPrompt(promptId, name);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.deleteSavedPrompt,
    (_event, ...args) => {
      const [promptId] = args as [number];
      return projectService.deleteProjectSavedPrompt(promptId);
    },
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.remove, (_event, ...args) => {
    const [projectId] = args as [number];
    return projectService.deleteProject(projectId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.getFiles, (_event, ...args) => {
    const [projectId] = args as [number];
    return projectService.listFiles(projectId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.get, (_event, ...args) => {
    const [fileId] = args as [number];
    return projectService.getFile(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.remove, (_event, ...args) => {
    const [fileId] = args as [number];
    return projectService.deleteFile(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.addFile, (_event, ...args) => {
    const [projectId, filePath, options] = args as [number, string, ImportOptions];
    return projectService.addFileToProject(projectId, filePath, options);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.createPastedSourceFile,
    (_event, ...args) => {
      const [projectId, input] = args as [number, PastedSourceFileInput];
      return projectService.createPastedSourceFile(projectId, input);
    },
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.getSegments, (_event, ...args) => {
    const [fileId, offset, limit] = args as [number, number, number];
    return projectService.getSegments(fileId, offset, limit);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.getPreview, (_event, ...args) => {
    const [filePath] = args as [string];
    return projectService.getSpreadsheetPreview(filePath);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.segment.update, (_event, ...args) => {
    const [segmentId, targetTokens, status, clientRequestId] = args as [
      string,
      Token[],
      SegmentStatus,
      string | undefined,
    ];
    return projectService.updateSegment(segmentId, targetTokens, status, clientRequestId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.export, (_event, ...args) => {
    const [fileId, outputPath, options, forceExport] = args as [
      number,
      string,
      ImportOptions | undefined,
      boolean | undefined,
    ];
    return projectService.exportFile(fileId, outputPath, options, forceExport ?? false);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.runQA, (_event, ...args) => {
    const [fileId] = args as [number];
    return projectService.runFileQA(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.inspect, (_event, ...args) => {
    const [fileId, outputPath] = args as [number, string];
    return projectService.inspectFile(fileId, outputPath);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.exportReferences,
    (_event, ...args) => {
      const [fileId, outputPath] = args as [number, string];
      return projectService.exportReferencesForMt(fileId, outputPath);
    },
  );
}
