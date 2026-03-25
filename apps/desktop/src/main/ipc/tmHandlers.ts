import { randomUUID } from 'crypto';
import type { Segment } from '@cat/core/models';
import type { StructuredJobError, TMImportOptions, TMType } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { JobBackedHandlerDeps } from './types';

function registerHandle(
  deps: JobBackedHandlerDeps,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown,
) {
  deps.ipcMain.removeHandler?.(channel);
  deps.ipcMain.handle(channel, listener);
}

export function registerTMHandlers({
  ipcMain,
  projectService,
  jobManager,
}: JobBackedHandlerDeps): void {
  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.getMatches,
    (_event, ...args) => {
      const [projectId, segment] = args as [number, Segment];
      return projectService.findMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.concordance,
    (_event, ...args) => {
      const [projectId, query] = args as [number, string];
      return projectService.searchConcordance(projectId, query);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.list,
    (_event, ...args) => {
      const [type] = args as [TMType | undefined];
      return projectService.listTMs(type);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.create,
    (_event, ...args) => {
      const [name, srcLang, tgtLang, type] = args as [string, string, string, TMType | undefined];
      return projectService.createTM(name, srcLang, tgtLang, type);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.remove,
    (_event, ...args) => {
      const [tmId] = args as [string];
      return projectService.deleteTM(tmId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.getMountedByProject,
    (_event, ...args) => {
      const [projectId] = args as [number];
      return projectService.getProjectMountedTMs(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.mount,
    (_event, ...args) => {
      const [projectId, tmId, priority, permission] = args as [
        number,
        string,
        number | undefined,
        string | undefined,
      ];
      return projectService.mountTMToProject(projectId, tmId, priority, permission);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.unmount,
    (_event, ...args) => {
      const [projectId, tmId] = args as [number, string];
      return projectService.unmountTMFromProject(projectId, tmId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.commitFile,
    (_event, ...args) => {
      const [tmId, fileId] = args as [string, number];
      return projectService.commitToMainTM(tmId, fileId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.matchFile,
    (_event, ...args) => {
      const [fileId, tmId] = args as [number, string];
      return projectService.batchMatchFileWithTM(fileId, tmId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.importPreview,
    (_event, ...args) => {
      const [filePath] = args as [string];
      return projectService.getTMImportPreview(filePath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.importExecute,
    (_event, ...args) => {
      const [tmId, filePath, options] = args as [string, string, TMImportOptions];
      const jobId = randomUUID();
      jobManager.startJob(jobId, 'TM import started');

      void projectService
        .importTMEntries(tmId, filePath, options, (data) => {
          const progress = data.total === 0 ? 0 : Math.round((data.current / data.total) * 100);
          jobManager.updateProgress(jobId, {
            progress,
            message: data.message,
          });
        })
        .then((result) => {
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'completed',
            message: `TM import completed: ${result.success} imported, ${result.skipped} skipped`,
            result: {
              kind: 'tm-import',
              success: result.success,
              skipped: result.skipped,
            },
          });
        })
        .catch((error) => {
          const structuredError = toStructuredJobError(error, 'TM_IMPORT_FAILED');
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'failed',
            message: structuredError.message,
            error: structuredError,
          });
        });

      return jobId;
    },
  );
}

function toStructuredJobError(error: unknown, code: string): StructuredJobError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      details: error.stack,
    };
  }

  return {
    code,
    message: String(error),
  };
}
