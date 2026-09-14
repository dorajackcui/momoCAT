import { randomUUID } from 'crypto';
import { access } from 'fs/promises';
import type { StructuredJobError, TBSyncStartResult } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { ReferenceBackedHandlerDeps } from './types';
import {
  isFiniteNumber,
  isId,
  isNonEmptyString,
  isString,
  readArgument,
  readOptionalArgument,
} from './argumentValidation';
import { isSegment } from './projectPayloadValidation';
import { isTBImportOptions, isTBSyncConfigInput } from './referencePayloadValidation';

export function registerTBHandlers({
  ipcMain,
  projectService,
  jobManager,
  referenceLookup,
  referenceLookupPrefetch,
  notifyReferenceDataChanged,
}: ReferenceBackedHandlerDeps): void {
  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.getMatches,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const segment = readArgument(args[1], 'segment', isSegment);
      return referenceLookup.findTbMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.prefetch,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const segment = readArgument(args[1], 'segment', isSegment);
      return referenceLookupPrefetch.findTbMatches(projectId, segment);
    },
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.tb.list, () =>
    projectService.listTBs(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.preview,
    (_event, ...args) => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      return projectService.getTBPreview(tbId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.create,
    async (_event, ...args) => {
      const name = readArgument(args[0], 'name', isString);
      const srcLang = readArgument(args[1], 'srcLang', isString);
      const tgtLang = readArgument(args[2], 'tgtLang', isString);
      const tbId = await projectService.createTB(name, srcLang, tgtLang);
      notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-created' });
      return tbId;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.remove,
    async (_event, ...args) => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      const result = await projectService.deleteTB(tbId);
      notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-deleted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.rename,
    async (_event, ...args) => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      const name = readArgument(args[1], 'name', isString);
      const result = await projectService.renameTB(tbId, name);
      notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-renamed' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.getMountedByProject,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      return projectService.getProjectMountedTBs(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.mount,
    async (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tbId = readArgument(args[1], 'tbId', isNonEmptyString);
      const priority = readOptionalArgument(args[2], 'priority', isFiniteNumber);
      const result = await projectService.mountTBToProject(projectId, tbId, priority);
      notifyReferenceDataChanged({ projectId, kind: 'tb', reason: 'tb-mounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.unmount,
    async (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tbId = readArgument(args[1], 'tbId', isNonEmptyString);
      const result = await projectService.unmountTBFromProject(projectId, tbId);
      notifyReferenceDataChanged({ projectId, kind: 'tb', reason: 'tb-unmounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.importPreview,
    (_event, ...args) => {
      const filePath = readArgument(args[0], 'filePath', isNonEmptyString);
      return projectService.getTBImportPreview(filePath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.importExecute,
    (_event, ...args) => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      const filePath = readArgument(args[1], 'filePath', isNonEmptyString);
      const options = readArgument(args[2], 'options', isTBImportOptions);
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
          notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-imported' });
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

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.syncSetConfig,
    (_event, ...args) => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      const config = readArgument(args[1], 'config', isTBSyncConfigInput);
      return projectService.setTBSyncConfig(tbId, config);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tb.syncExecute,
    async (_event, ...args): Promise<TBSyncStartResult> => {
      const tbId = readArgument(args[0], 'tbId', isNonEmptyString);
      const config = projectService.getTBSyncConfig(tbId);
      if (!config) {
        throw new Error('This term base is not bound to a local Excel file.');
      }

      try {
        await access(config.filePath);
      } catch {
        return { status: 'file-missing', filePath: config.filePath };
      }

      const jobId = randomUUID();
      jobManager.startJob(jobId, 'TB sync started');

      void projectService
        .syncTBEntriesFromExcel(tbId, (data) => {
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
            message: `TB sync completed: ${result.success} synced, ${result.skipped} skipped`,
            result: {
              kind: 'tb-sync',
              success: result.success,
              skipped: result.skipped,
            },
          });
          notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-synced' });
        })
        .catch((error) => {
          const structuredError = toStructuredJobError(error, 'TB_SYNC_FAILED');
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'failed',
            message: structuredError.message,
            error: structuredError,
          });
        });

      return { status: 'started', jobId };
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
