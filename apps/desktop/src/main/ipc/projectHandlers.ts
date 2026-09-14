import type { ProjectQASettings, ProjectType } from '@cat/core/project';
import type { SegmentStatus, Token } from '@cat/core/models';
import type { ImportOptions, PastedSourceFileInput } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { MainHandlerDeps } from './types';

const SEGMENT_STATUSES = {
  new: true,
  draft: true,
  translated: true,
  confirmed: true,
  reviewed: true,
} satisfies Record<SegmentStatus, true>;

const TOKEN_TYPES = {
  text: true,
  tag: true,
  locked: true,
  ws: true,
} satisfies Record<Token['type'], true>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSegmentStatus(value: unknown): value is SegmentStatus {
  return typeof value === 'string' && Object.hasOwn(SEGMENT_STATUSES, value);
}

function isToken(value: unknown): value is Token {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !Object.hasOwn(TOKEN_TYPES, value.type) ||
    typeof value.content !== 'string'
  ) {
    return false;
  }
  const meta = value.meta;
  if (meta === undefined) return true;
  return (
    isRecord(meta) &&
    (meta.id === undefined || typeof meta.id === 'string') &&
    (meta.tagType === undefined ||
      meta.tagType === 'paired-start' ||
      meta.tagType === 'paired-end' ||
      meta.tagType === 'standalone') &&
    (meta.pairedIndex === undefined ||
      (typeof meta.pairedIndex === 'number' && Number.isFinite(meta.pairedIndex))) &&
    (meta.validationState === undefined ||
      meta.validationState === 'valid' ||
      meta.validationState === 'error' ||
      meta.validationState === 'warning')
  );
}

function isTokenArray(value: unknown): value is Token[] {
  if (!Array.isArray(value)) return false;
  for (const token of value) {
    if (!isToken(token)) return false;
  }
  return true;
}

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
    IPC_CHANNELS.project.updateSavedPrompt,
    (_event, ...args) => {
      const [projectId, promptId, name, content] = args as [number, number, string, string];
      return projectService.updateProjectSavedPrompt(projectId, promptId, name, content);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.project.deleteSavedPrompt,
    (_event, ...args) => {
      const [projectId, promptId] = args as [number, number];
      return projectService.deleteProjectSavedPrompt(projectId, promptId);
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

  registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.rename, (_event, ...args) => {
    const [fileId, name] = args as [number, string];
    return projectService.renameFile(fileId, name);
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
    const [segmentId, targetTokens, status, clientRequestId] = args;
    if (typeof segmentId !== 'string' || !segmentId.trim()) {
      throw new Error('A non-empty segment ID is required.');
    }
    if (!isTokenArray(targetTokens)) {
      throw new Error('Segment target must be an array of valid tokens.');
    }
    if (!isSegmentStatus(status)) {
      throw new Error('Invalid segment status.');
    }
    if (clientRequestId !== undefined && typeof clientRequestId !== 'string') {
      throw new Error('Segment client request ID must be a string.');
    }
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

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.precheckSourceTerminology,
    (_event, ...args) => {
      const [fileId, outputPath] = args as [number, string];
      return projectService.precheckSourceTerminology(fileId, outputPath);
    },
  );

  registerHandle(
    { ipcMain, projectService },
    IPC_CHANNELS.file.cancelSourceTerminologyPrecheck,
    (_event, ...args) => {
      const [fileId] = args as [number];
      return projectService.cancelSourceTerminologyPrecheck(fileId);
    },
  );
}
