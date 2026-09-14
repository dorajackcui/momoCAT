import { randomUUID } from 'crypto';
import { access } from 'fs/promises';
import type { StructuredJobError, TMSyncStartResult } from '../../shared/ipc';
import { TM_SYNC_MAPPING_REVIEW_REQUIRED } from '../../shared/ipc';
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
import {
  isTMCommitOptions,
  isTMImportOptions,
  isTMSyncConfigInput,
  isTMType,
} from './referencePayloadValidation';

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
      const projectId = readArgument(args[0], 'projectId', isId);
      const segment = readArgument(args[1], 'segment', isSegment);
      return referenceLookup.findTmMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.prefetch,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const segment = readArgument(args[1], 'segment', isSegment);
      return referenceLookupPrefetch.findTmMatches(projectId, segment);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.concordance,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const query = readArgument(args[1], 'query', isString);
      return referenceLookup.searchConcordance(projectId, query);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.list,
    (_event, ...args) => {
      const type = readOptionalArgument(args[0], 'type', isTMType);
      return projectService.listTMs(type);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.listOptions,
    (_event, ...args) => {
      const type = readOptionalArgument(args[0], 'type', isTMType);
      return projectService.listTMOptions(type);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.preview,
    (_event, ...args) => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      return projectService.getTMPreview(tmId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.create,
    async (_event, ...args) => {
      const name = readArgument(args[0], 'name', isString);
      const srcLang = readArgument(args[1], 'srcLang', isString);
      const tgtLang = readArgument(args[2], 'tgtLang', isString);
      const type = readOptionalArgument(args[3], 'type', isTMType);
      const tmId = await projectService.createTM(name, srcLang, tgtLang, type);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-created' });
      return tmId;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.remove,
    async (_event, ...args) => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const result = await projectService.deleteTM(tmId);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-deleted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.rename,
    async (_event, ...args) => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const name = readArgument(args[1], 'name', isString);
      const result = await projectService.renameTM(tmId, name);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-renamed' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.getMountedByProject,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      return projectService.getProjectMountedTMs(projectId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.mount,
    async (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tmId = readArgument(args[1], 'tmId', isNonEmptyString);
      const priority = readOptionalArgument(args[2], 'priority', isFiniteNumber);
      const permission = readOptionalArgument(args[3], 'permission', isString);
      const result = await projectService.mountTMToProject(projectId, tmId, priority, permission);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'tm-mounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.unmount,
    async (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tmId = readArgument(args[1], 'tmId', isNonEmptyString);
      const result = await projectService.unmountTMFromProject(projectId, tmId);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'tm-unmounted' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.exportWorking,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tmId = readArgument(args[1], 'tmId', isNonEmptyString);
      const outputPath = readArgument(args[2], 'outputPath', isNonEmptyString);
      return projectService.exportWorkingTM(projectId, tmId, outputPath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.resetWorking,
    async (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const tmId = readArgument(args[1], 'tmId', isNonEmptyString);
      const result = await projectService.resetWorkingTM(projectId, tmId);
      notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'working-tm-reset' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.commitFile,
    async (_event, ...args) => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const fileId = readArgument(args[1], 'fileId', isId);
      const options = readOptionalArgument(args[2], 'options', isTMCommitOptions);
      const result = await projectService.commitFileToTM(tmId, fileId, options);
      notifyReferenceDataChanged(
        result.tmType === 'working'
          ? { projectId: result.projectId, kind: 'tm', reason: 'working-tm-updated' }
          : { projectId: null, kind: 'tm', reason: 'tm-committed' },
      );
      return result.committedCount;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.matchFile,
    async (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      const tmId = readArgument(args[1], 'tmId', isNonEmptyString);
      const result = await projectService.batchMatchFileWithTM(fileId, tmId);
      notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-batch-matched' });
      return result;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.importPreview,
    (_event, ...args) => {
      const filePath = readArgument(args[0], 'filePath', isNonEmptyString);
      return projectService.getTMImportPreview(filePath);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.importExecute,
    (_event, ...args) => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const filePath = readArgument(args[1], 'filePath', isNonEmptyString);
      const options = readArgument(args[2], 'options', isTMImportOptions);
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
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const config = readArgument(args[1], 'config', isTMSyncConfigInput);
      return projectService.setTMSyncConfig(tmId, config);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.tm.syncExecute,
    async (_event, ...args): Promise<TMSyncStartResult> => {
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const config = projectService.getTMSyncConfig(tmId);
      if (!config) {
        throw new Error('This TM is not bound to a local Excel file.');
      }
      if (!config.columnIdentity) {
        return {
          status: 'mapping-review-required',
          filePath: config.filePath,
          reason: 'The saved source/target mapping must be reviewed before strict sync.',
        };
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
      const tmId = readArgument(args[0], 'tmId', isNonEmptyString);
      const jobId = readArgument(args[1], 'jobId', isNonEmptyString);
      jobManager.cancelJob(jobId);
      return projectService.cancelTMSync(tmId);
    },
  );
}

function toStructuredJobError(error: unknown, code: string): StructuredJobError {
  if (error instanceof Error) {
    const mappingPrefix = `${TM_SYNC_MAPPING_REVIEW_REQUIRED}:`;
    const mappingReviewRequired = error.message.startsWith(mappingPrefix);
    const mappingMessage = error.message.slice(mappingPrefix.length).split('\n', 1)[0].trim();
    return {
      code: mappingReviewRequired ? TM_SYNC_MAPPING_REVIEW_REQUIRED : code,
      message: mappingReviewRequired ? mappingMessage : error.message,
      details: error.stack,
    };
  }

  return {
    code,
    message: String(error),
  };
}
