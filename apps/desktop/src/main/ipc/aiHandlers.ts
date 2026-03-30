import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { AITranslateFileOptions } from '../../shared/ipc';
import type { AIHandlerDeps } from './types';

function registerHandle(
  deps: AIHandlerDeps,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown,
) {
  deps.ipcMain.removeHandler?.(channel);
  deps.ipcMain.handle(channel, listener);
}

export function registerAIHandlers({ ipcMain, projectService, jobManager }: AIHandlerDeps): void {
  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.getSettings, () =>
    projectService.getAISettings(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.setKey,
    (_event, ...args) => {
      const [apiKey] = args as [string];
      return projectService.setAIKey(apiKey);
    },
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.clearKey, () =>
    projectService.clearAIKey(),
  );

  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.listProviders, () =>
    projectService.listAIProviders(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.testProvider,
    (_event, ...args) => {
      const [input] = args as [Parameters<typeof projectService.testAIProvider>[0]];
      return projectService.testAIProvider(input);
    },
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
    IPC_CHANNELS.ai.testConnection,
    (_event, ...args) => {
      const [apiKey] = args as [string | undefined];
      return projectService.testAIConnection(apiKey);
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

      projectService
        .aiTranslateFile(fileId, {
          mode: options?.mode,
          targetScope: options?.targetScope,
          onProgress: (data) => {
            const progress = data.total === 0 ? 100 : Math.round((data.current / data.total) * 100);
            jobManager.updateProgress(jobId, {
              progress,
              message: data.message,
            });
          },
        })
        .then((result) => {
          jobManager.updateProgress(jobId, {
            progress: 100,
            status: 'completed',
            message: `AI translation completed: ${result.translated} translated, ${result.skipped} skipped, ${result.failed} failed`,
          });
        })
        .catch((error) => {
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
    IPC_CHANNELS.ai.testTranslate,
    async (_event, ...args) => {
      const [projectId, sourceText, contextText] = args as [number, string, string | undefined];
      try {
        return await projectService.aiTestTranslate(projectId, sourceText, contextText);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          promptUsed: '',
          userMessage: sourceText
            ? [
                `Source:\n${sourceText}`,
                contextText?.trim() ? `Context: ${contextText.trim()}` : '',
              ]
                .filter(Boolean)
                .join('\n\n')
            : '',
          translatedText: '',
        };
      }
    },
  );
}
