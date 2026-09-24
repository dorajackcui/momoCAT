import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { MainHandlerDeps } from './types';
import {
  isBoolean,
  isId,
  isNonEmptyString,
  isNonNegativeInteger,
  isNullableString,
  isString,
  readArgument,
  readOptionalArgument,
} from './argumentValidation';
import {
  isImportOptions,
  isPastedSourceFileInput,
  isProjectQASettings,
  isProjectType,
  isSegmentStatus,
  isSelectedSegmentUpdates,
  isTokenArray,
} from './projectPayloadValidation';

export function registerProjectHandlers({ ipcMain, projectService }: MainHandlerDeps): void {
  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.list, () =>
    projectService.listProjects(),
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.create, (_event, ...args) => {
    const name = readArgument(args[0], 'name', isString);
    const srcLang = readArgument(args[1], 'srcLang', isString);
    const tgtLang = readArgument(args[2], 'tgtLang', isString);
    const projectType = readOptionalArgument(args[3], 'projectType', isProjectType);
    return projectService.createProject(name, srcLang, tgtLang, projectType);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.get, (_event, ...args) => {
    const projectId = readArgument(args[0], 'projectId', isId);
    return projectService.getProject(projectId);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updatePrompt,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const aiPrompt = readArgument(args[1], 'aiPrompt', isNullableString);
      return projectService.updateProjectPrompt(projectId, aiPrompt);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateAISettings,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const aiPrompt = readArgument(args[1], 'aiPrompt', isNullableString);
      const aiProviderId = readArgument(args[2], 'aiProviderId', isNullableString);
      return projectService.updateProjectAISettings(projectId, aiPrompt, aiProviderId);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateQASettings,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const qaSettings = readArgument(args[1], 'qaSettings', isProjectQASettings);
      return projectService.updateProjectQASettings(projectId, qaSettings);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.listSavedPrompts,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      return projectService.listProjectSavedPrompts(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.createSavedPrompt,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const name = readArgument(args[1], 'name', isString);
      const content = readArgument(args[2], 'content', isString);
      return projectService.createProjectSavedPrompt(projectId, name, content);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.updateSavedPrompt,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const promptId = readArgument(args[1], 'promptId', isId);
      const name = readArgument(args[2], 'name', isString);
      const content = readArgument(args[3], 'content', isString);
      return projectService.updateProjectSavedPrompt(projectId, promptId, name, content);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.deleteSavedPrompt,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const promptId = readArgument(args[1], 'promptId', isId);
      return projectService.deleteProjectSavedPrompt(projectId, promptId);
    },
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.remove, (_event, ...args) => {
    const projectId = readArgument(args[0], 'projectId', isId);
    return projectService.deleteProject(projectId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.getFiles, (_event, ...args) => {
    const projectId = readArgument(args[0], 'projectId', isId);
    return projectService.listFiles(projectId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.get, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    return projectService.getFile(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.rename, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    const name = readArgument(args[1], 'name', isString);
    return projectService.renameFile(fileId, name);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.remove, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    return projectService.deleteFile(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.project.addFile, (_event, ...args) => {
    const projectId = readArgument(args[0], 'projectId', isId);
    const filePath = readArgument(args[1], 'filePath', isNonEmptyString);
    const options = readArgument(args[2], 'options', isImportOptions);
    return projectService.addFileToProject(projectId, filePath, options);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.createPastedSourceFile,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const input = readArgument(args[1], 'input', isPastedSourceFileInput);
      return projectService.createPastedSourceFile(projectId, input);
    },
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.getSegments, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    const offset = readArgument(args[1], 'offset', isNonNegativeInteger);
    const limit = readArgument(args[2], 'limit', isNonNegativeInteger);
    return projectService.getSegments(fileId, offset, limit);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.getPreview, (_event, ...args) => {
    const filePath = readArgument(args[0], 'filePath', isNonEmptyString);
    return projectService.getSpreadsheetPreview(filePath);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.segment.updateSelected,
    (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      const updates = readArgument(args[1], 'selected segment updates', isSelectedSegmentUpdates);
      return projectService.updateSelectedSegments(fileId, updates);
    },
  );

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.segment.update, (_event, ...args) => {
    const segmentId = readArgument(args[0], 'segmentId', isNonEmptyString);
    const targetTokens = readArgument(args[1], 'segment target tokens', isTokenArray);
    const status = readArgument(args[2], 'segment status', isSegmentStatus);
    const clientRequestId = readOptionalArgument(args[3], 'clientRequestId', isString);
    return projectService.updateSegment(segmentId, targetTokens, status, clientRequestId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.segment.checkQA, (_event, ...args) => {
    return projectService.checkSegmentQA(readArgument(args[0], 'segmentId', isNonEmptyString));
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.export, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    const outputPath = readArgument(args[1], 'outputPath', isNonEmptyString);
    const options = readOptionalArgument(args[2], 'options', isImportOptions);
    return projectService.exportFile(fileId, outputPath, options);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.runQA, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    return projectService.runFileQA(fileId);
  });

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.inspect, (_event, ...args) => {
    const fileId = readArgument(args[0], 'fileId', isId);
    const outputPath = readArgument(args[1], 'outputPath', isNonEmptyString);
    return projectService.inspectFile(fileId, outputPath);
  });

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.exportReferences,
    (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      const outputPath = readArgument(args[1], 'outputPath', isNonEmptyString);
      return projectService.exportReferencesForMt(fileId, outputPath);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.precheckSourceTerminology,
    (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      const outputPath = readArgument(args[1], 'outputPath', isNonEmptyString);
      return projectService.precheckSourceTerminology(fileId, outputPath);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.cancelSourceTerminologyPrecheck,
    (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      return projectService.cancelSourceTerminologyPrecheck(fileId);
    },
  );
}
