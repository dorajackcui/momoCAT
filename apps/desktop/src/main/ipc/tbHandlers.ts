import { randomUUID } from 'crypto';
import type { Segment } from '@cat/core/models';
import type { StructuredJobError, TBImportOptions } from '../../shared/ipc';
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

export function registerTBHandlers({
  ipcMain,
  projectService,
  jobManager,
}: JobBackedHandlerDeps): void {
  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.getMatches,
    (_event, ...args) => {
      const [projectId, segment] = args as [number, Segment];
      return projectService.findTermMatches(projectId, segment);
    },
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.tb.list, () =>
    projectService.listTBs(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.create,
    (_event, ...args) => {
      const [name, srcLang, tgtLang] = args as [string, string, string];
      return projectService.createTB(name, srcLang, tgtLang);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.remove,
    (_event, ...args) => {
      const [tbId] = args as [string];
      return projectService.deleteTB(tbId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.getMountedByProject,
    (_event, ...args) => {
      const [projectId] = args as [number];
      return projectService.getProjectMountedTBs(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.mount,
    (_event, ...args) => {
      const [projectId, tbId, priority] = args as [number, string, number | undefined];
      return projectService.mountTBToProject(projectId, tbId, priority);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.unmount,
    (_event, ...args) => {
      const [projectId, tbId] = args as [number, string];
      return projectService.unmountTBFromProject(projectId, tbId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.importPreview,
    (_event, ...args) => {
      const [filePath] = args as [string];
      return projectService.getTBImportPreview(filePath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.importExecute,
    (_event, ...args) => {
      const [tbId, filePath, options] = args as [string, string, TBImportOptions];
      const jobId = randomUUID();
      jobManager.startJob(jobId, 'TB import started');

      void projectService
        .importTBEntries(tbId, filePath, options, (data) => {
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
            message: `TB import completed: ${result.success} imported, ${result.skipped} skipped`,
            result: {
              kind: 'tb-import',
              success: result.success,
              skipped: result.skipped,
            },
          });
        })
        .catch((error) => {
          const structuredError = toStructuredJobError(error, 'TB_IMPORT_FAILED');
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
