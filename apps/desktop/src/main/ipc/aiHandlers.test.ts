import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerAIHandlers } from './aiHandlers';

function createIpcMainStub() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  };

  return { handlers, ipcMain };
}

describe('ai handlers', () => {
  it('forwards dialogue mode to project service when translating file', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const projectService = {
      getAISettings: vi.fn(),
      setAIKey: vi.fn(),
      clearAIKey: vi.fn(),
      listAIProviders: vi.fn(),
      testAIProvider: vi.fn(),
      addAIProvider: vi.fn(),
      deleteAIProvider: vi.fn(),
      getProxySettings: vi.fn(),
      setProxySettings: vi.fn(),
      testAIConnection: vi.fn(),
      aiTranslateSegment: vi.fn(),
      aiRefineSegment: vi.fn(),
      aiTestTranslate: vi.fn(),
      aiTranslateFile: vi.fn(async (_fileId, options) => {
        options?.onProgress?.({ current: 1, total: 2, message: 'Halfway' });
        return { translated: 2, skipped: 0, failed: 0 };
      }),
    };

    registerAIHandlers({
      ipcMain,
      projectService: projectService as never,
      jobManager: { startJob, updateProgress } as never,
    });

    const handler = handlers.get(IPC_CHANNELS.ai.translateFile);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 1, {
      mode: 'dialogue',
      targetScope: 'overwrite-non-confirmed',
    }) as string;
    expect(typeof jobId).toBe('string');
    expect(startJob).toHaveBeenCalledWith(jobId, 'AI translation started');
    expect(projectService.aiTranslateFile).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        mode: 'dialogue',
        targetScope: 'overwrite-non-confirmed',
        onProgress: expect.any(Function),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ progress: 50, message: 'Halfway' }),
    );
    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('passes ai test translate results through without synthesizing fallback prompts', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const projectService = {
      getAISettings: vi.fn(),
      setAIKey: vi.fn(),
      clearAIKey: vi.fn(),
      listAIProviders: vi.fn(),
      testAIProvider: vi.fn(),
      addAIProvider: vi.fn(),
      deleteAIProvider: vi.fn(),
      getProxySettings: vi.fn(),
      setProxySettings: vi.fn(),
      testAIConnection: vi.fn(),
      aiTranslateSegment: vi.fn(),
      aiRefineSegment: vi.fn(),
      aiTranslateFile: vi.fn(),
      aiTestTranslate: vi.fn().mockResolvedValue({
        ok: false,
        error: 'transport failed',
        systemPrompt: 'system prompt',
        userPrompt: 'user prompt',
        translatedText: '',
      }),
    };

    registerAIHandlers({
      ipcMain,
      projectService: projectService as never,
      jobManager: { startJob: vi.fn(), updateProgress: vi.fn() } as never,
    });

    const handler = handlers.get(IPC_CHANNELS.ai.testTranslate);
    expect(handler).toBeDefined();

    await expect(handler?.({}, 11, 'Input', 'Context')).resolves.toEqual({
      ok: false,
      error: 'transport failed',
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      translatedText: '',
    });
    expect(projectService.aiTestTranslate).toHaveBeenCalledWith(11, 'Input', 'Context');
  });
});
