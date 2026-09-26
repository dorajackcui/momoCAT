import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerHandle } from './registerHandle';
import type { AIHandlerDeps } from './types';
import {
  isId,
  isNonEmptyString,
  isString,
  readArgument,
  readOptionalArgument,
} from './argumentValidation';
import {
  isAddAIProviderInput,
  isProxySettingsInput,
  isSourceTerminologyPromptInput,
  isTestAIConnectionInput,
  readAITranslateFileOptions,
} from './aiPayloadValidation';

export function registerAIHandlers({ ipcMain, projectService, jobManager }: AIHandlerDeps): void {
  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.getSettings, () =>
    projectService.getAISettings(),
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.listConnections, () =>
    projectService.listAIConnections(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.testConnection,
    (_event, ...args) => {
      const input = readArgument(args[0], 'AI connection input', isTestAIConnectionInput);
      return projectService.testAIConnection(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.deleteConnection,
    (_event, ...args) => {
      const connectionId = readArgument(args[0], 'connectionId', isNonEmptyString);
      return projectService.deleteAIConnection(connectionId);
    },
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.listProviders, () =>
    projectService.listAIProviders(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.addProvider,
    (_event, ...args) => {
      const input = readArgument(args[0], 'AI provider input', isAddAIProviderInput);
      return projectService.addAIProvider(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.deleteProvider,
    (_event, ...args) => {
      const providerId = readArgument(args[0], 'providerId', isNonEmptyString);
      return projectService.deleteAIProvider(providerId);
    },
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.getProxySettings, () =>
    projectService.getProxySettings(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.setProxySettings,
    (_event, ...args) => {
      const settings = readArgument(args[0], 'proxy settings', isProxySettingsInput);
      return projectService.setProxySettings(settings);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.getSourceTerminologyPromptSettings,
    () => projectService.getSourceTerminologyPromptSettings(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.setSourceTerminologyPromptSettings,
    (_event, ...args) => {
      const input = readArgument(
        args[0],
        'source terminology prompt input',
        isSourceTerminologyPromptInput,
      );
      return projectService.setSourceTerminologyPromptSettings(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.translateSegment,
    (_event, ...args) => {
      const segmentId = readArgument(args[0], 'segmentId', isNonEmptyString);
      return projectService.aiTranslateSegment(segmentId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.refineSegment,
    (_event, ...args) => {
      const segmentId = readArgument(args[0], 'segmentId', isNonEmptyString);
      const instruction = readArgument(args[1], 'instruction', isString);
      return projectService.aiRefineSegment(segmentId, instruction);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.translateFile,
    (_event, ...args) => {
      const fileId = readArgument(args[0], 'fileId', isId);
      const options = readAITranslateFileOptions(args[1]);
      const jobId = randomUUID();
      jobManager.startJob(jobId, 'AI translation started');
      const cancellationToken = jobManager.getCancellationToken(jobId);

      projectService
        .aiTranslateFile(fileId, {
          targetBaseline: options?.targetBaseline,
          segmentIds: options?.segmentIds,
          cancellationToken,
          onProgress: (data) => {
            if (jobManager.isCancellationRequested(jobId)) {
              return;
            }

            const progress = data.total === 0 ? 100 : Math.round((data.current / data.total) * 100);
            jobManager.updateProgress(jobId, {
              progress,
              message: data.message,
            });
          },
        })
        .then((result) => {
          if (jobManager.isCancellationRequested(jobId)) {
            jobManager.updateProgress(jobId, {
              progress: 100,
              status: 'cancelled',
              cancelRequested: true,
              message: 'Cancelled. Partial results kept.',
            });
            return;
          }

          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'completed',
            message: `AI translation completed: ${result.translated} translated, ${result.skipped} skipped, ${result.failed} failed`,
          });
        })
        .catch((error) => {
          if (jobManager.isCancellationRequested(jobId)) {
            jobManager.updateProgress(jobId, {
              progress: 100,
              status: 'cancelled',
              cancelRequested: true,
              message: 'Cancelled. Partial results kept.',
            });
            return;
          }

          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        });

      return jobId;
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.cancelFileJob,
    (_event, ...args) => {
      const jobId = readArgument(args[0], 'jobId', isNonEmptyString);
      return jobManager.cancelJob(jobId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.testTranslate,
    (_event, ...args) => {
      const projectId = readArgument(args[0], 'projectId', isId);
      const sourceText = readArgument(args[1], 'sourceText', isString);
      const contextText = readOptionalArgument(args[2], 'contextText', isString);
      return projectService.aiTestTranslate(projectId, sourceText, contextText);
    },
  );
}
