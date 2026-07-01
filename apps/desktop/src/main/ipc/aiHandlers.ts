import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { AITranslateFileOptions } from '../../shared/ipc';
import { registerHandle } from './registerHandle';
import type { AIHandlerDeps } from './types';

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
      const [input] = args as [Parameters<typeof projectService.testAIConnection>[0]];
      return projectService.testAIConnection(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.deleteConnection,
    (_event, ...args) => {
      const [connectionId] = args as [string];
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
      const [input] = args as [Parameters<typeof projectService.addAIProvider>[0]];
      return projectService.addAIProvider(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.deleteProvider,
    (_event, ...args) => {
      const [providerId] = args as [string];
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
      const [settings] = args as [Parameters<typeof projectService.setProxySettings>[0]];
      return projectService.setProxySettings(settings);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.translateSegment,
    (_event, ...args) => {
      const [segmentId] = args as [string];
      return projectService.aiTranslateSegment(segmentId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.refineSegment,
    (_event, ...args) => {
      const [segmentId, instruction] = args as [string, string];
      return projectService.aiRefineSegment(segmentId, instruction);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.translateFile,
    (_event, ...args) => {
      const [fileId, options] = args as [number, AITranslateFileOptions | undefined];
      const jobId = randomUUID();
      jobManager.startJob(jobId, 'AI translation started');
      const cancellationToken = jobManager.getCancellationToken(jobId);

      projectService
        .aiTranslateFile(fileId, {
          mode: options?.mode,
          targetScope: options?.targetScope,
          targetBaseline: options?.targetBaseline,
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
      const [jobId] = args as [string];
      return jobManager.cancelJob(jobId);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.testTranslate,
    (_event, ...args) => {
      const [projectId, sourceText, contextText] = args as [number, string, string | undefined];
      return projectService.aiTestTranslate(projectId, sourceText, contextText);
    },
  );
}
