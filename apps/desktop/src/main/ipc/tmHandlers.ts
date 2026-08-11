import { randomUUID } from 'crypto';
import { access } from 'fs/promises';
import type { Segment } from '@cat/core/models';
import type {
  StructuredJobError,
  TMCommitOptions,
  TMImportOptions,
  TMSyncConfigInput,
  TMSyncStartResult,
  TMType,
} from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { ReferenceBackedHandlerDeps } from './types';

export function registerTMHandlers({
  ipcMain,
  projectService,
  jobManager,
  referenceLookup,
  referenceLookupPrefetch,
  notifyReferenceDataChanged,
}: ReferenceBackedHandlerDeps): void {
  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.getMatches,
    (_event, ...args) => {
      const [projectId, segment] = args as [number, Segment];
      return referenceLookup.findTmMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.prefetch,
    (_event, ...args) => {
      const [projectId, segment] = args as [number, Segment];
      return referenceLookupPrefetch.findTmMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.concordance,
    (_event, ...args) => {
      const [projectId, query] = args as [number, string];
      return referenceLookup.searchConcordance(projectId, query);
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
    IPC_CHANNELS.tm.listOptions,
    (_event, ...args) => {
      const [type] = args as [TMType | undefined];
      return projectService.listTMOptions(type);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.preview,
    (_event, ...args) => {
      const [tmId] = args as [string];
      return projectService.getTMPreview(tmId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.create,
    async (_event, ...args) => {
      const [name, srcLang, tgtLang, type] = args as [string, string, string, TMType | undefined];
      const tmId = await projectService.createTM(name, srcLang, tgtLang, type);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-created' });
      return tmId;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.remove,
    async (_event, ...args) => {
      const [tmId] = args as [string];
      const result = await projectService.deleteTM(tmId);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-deleted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.rename,
    async (_event, ...args) => {
      const [tmId, name] = args as [string, string];
      const result = await projectService.renameTM(tmId, name);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-renamed' });
      return result;
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
    async (_event, ...args) => {
      const [projectId, tmId, priority, permission] = args as [
        number,
        string,
        number | undefined,
        string | undefined,
      ];
      const result = await projectService.mountTMToProject(projectId, tmId, priority, permission);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'tm-mounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.unmount,
    async (_event, ...args) => {
      const [projectId, tmId] = args as [number, string];
      const result = await projectService.unmountTMFromProject(projectId, tmId);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'tm-unmounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.exportWorking,
    (_event, ...args) => {
      const [projectId, tmId, outputPath] = args as [number, string, string];
      return projectService.exportWorkingTM(projectId, tmId, outputPath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.resetWorking,
    async (_event, ...args) => {
      const [projectId, tmId] = args as [number, string];
      const result = await projectService.resetWorkingTM(projectId, tmId);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'working-tm-reset' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.commitFile,
    async (_event, ...args) => {
      const [tmId, fileId, options] = args as [string, number, TMCommitOptions | undefined];
      const result = await projectService.commitToMainTM(tmId, fileId, options);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-committed' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.matchFile,
    async (_event, ...args) => {
      const [fileId, tmId] = args as [number, string];
      const result = await projectService.batchMatchFileWithTM(fileId, tmId);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-batch-matched' });
      return result;
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
          notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-imported' });
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

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.syncSetConfig,
    (_event, ...args) => {
      const [tmId, config] = args as [string, TMSyncConfigInput];
      return projectService.setTMSyncConfig(tmId, config);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.syncExecute,
    async (_event, ...args): Promise<TMSyncStartResult> => {
      const [tmId] = args as [string];
      const config = projectService.getTMSyncConfig(tmId);
      if (!config) {
        throw new Error('This TM is not bound to a local Excel file.');
      }

      try {
        await access(config.filePath);
      } catch {
        return { status: 'file-missing', filePath: config.filePath };
      }

      const jobId = randomUUID();
      jobManager.startJob(jobId, 'TM sync started');

      void projectService
        .syncTMEntriesFromExcel(tmId, (data) => {
          const progress = data.total === 0 ? 0 : Math.round((data.current / data.total) * 100);
          jobManager.updateProgress(jobId, {
            progress,
            message: data.message,
          });
        })
        .then((report) => {
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: report.cancelled ? 'cancelled' : 'completed',
            message: report.cancelled
              ? `TM sync cancelled: ${report.added} added, ${report.updated} updated before stopping`
              : `TM sync completed: ${report.added} added, ${report.updated} updated, ${report.deleted} removed, ${report.unchanged} unchanged`,
            result: {
              kind: 'tm-sync',
              success: report.added + report.updated + report.deleted,
              skipped: report.skipped,
              report,
            },
          });
          // Even a cancelled run may have applied a prefix of the changes.
          notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-synced' });
        })
        .catch((error) => {
          const structuredError = toStructuredJobError(error, 'TM_SYNC_FAILED');
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'failed',
            message: structuredError.message,
            error: structuredError,
          });
          notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-synced' });
        });

      return { status: 'started', jobId };
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.syncCancel,
    (_event, ...args) => {
      const [tmId, jobId] = args as [string, string];
      jobManager.cancelJob(jobId);
      return projectService.cancelTMSync(tmId);
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
