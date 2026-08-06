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
  it('delegates source terminology prompt settings through the AI boundary', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const settings = {
      prompt: 'Prefer named locations.',
      activePromptId: 'prompt-1',
      prompts: [
        {
          id: 'prompt-1',
          name: 'Locations',
          prompt: 'Prefer named locations.',
          isBuiltin: false,
        },
      ],
      maxChars: 12000,
      maxNameChars: 80,
    };
    const getSourceTerminologyPromptSettings = vi.fn().mockReturnValue(settings);
    const setSourceTerminologyPromptSettings = vi.fn().mockReturnValue(settings);

    registerAIHandlers({
      ipcMain,
      projectService: {
        getSourceTerminologyPromptSettings,
        setSourceTerminologyPromptSettings,
      } as never,
      jobManager: {} as never,
    });

    expect(handlers.get(IPC_CHANNELS.ai.getSourceTerminologyPromptSettings)?.({})).toBe(settings);
    expect(
      handlers.get(IPC_CHANNELS.ai.setSourceTerminologyPromptSettings)?.(
        {},
        {
          action: 'create',
          name: 'Locations',
          prompt: 'Prefer named locations.',
        },
      ),
    ).toBe(settings);
    expect(setSourceTerminologyPromptSettings).toHaveBeenCalledWith({
      action: 'create',
      name: 'Locations',
      prompt: 'Prefer named locations.',
    });
  });

  it('forwards file translate options to project service when translating file', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const projectService = {
      getAISettings: vi.fn(),
      listAIProviders: vi.fn(),
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
      jobManager: {
        startJob,
        updateProgress,
        getCancellationToken: vi.fn(() => ({ isCancellationRequested: () => false })),
        isCancellationRequested: vi.fn(() => false),
      } as never,
    });

    const handler = handlers.get(IPC_CHANNELS.ai.translateFile);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 1, {
      mode: 'dialogue',
      targetScope: 'overwrite-non-confirmed',
      targetBaseline: 'ignore-current-targets',
    }) as string;
    expect(typeof jobId).toBe('string');
    expect(startJob).toHaveBeenCalledWith(jobId, 'AI translation started');
    expect(projectService.aiTranslateFile).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        mode: 'dialogue',
        targetScope: 'overwrite-non-confirmed',
        targetBaseline: 'ignore-current-targets',
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

  it('registers an AI file job cancel handler', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const cancelJob = vi.fn().mockReturnValue(true);

    registerAIHandlers({
      ipcMain,
      projectService: {
        getAISettings: vi.fn(),
        listAIProviders: vi.fn(),
        addAIProvider: vi.fn(),
        deleteAIProvider: vi.fn(),
        getProxySettings: vi.fn(),
        setProxySettings: vi.fn(),
        testAIConnection: vi.fn(),
        aiTranslateSegment: vi.fn(),
        aiRefineSegment: vi.fn(),
        aiTranslateFile: vi.fn(),
        aiTestTranslate: vi.fn(),
      } as never,
      jobManager: { startJob: vi.fn(), updateProgress: vi.fn(), cancelJob } as never,
    });

    const handler = handlers.get(IPC_CHANNELS.ai.cancelFileJob);
    expect(handler).toBeDefined();

    expect(handler?.({}, 'job-1')).toBe(true);
    expect(cancelJob).toHaveBeenCalledWith('job-1');
  });

  it('passes a cancellation token to file translation and settles cancelled jobs as cancelled', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const cancellationToken = { isCancellationRequested: vi.fn(() => true) };
    const getCancellationToken = vi.fn(() => cancellationToken);
    const isCancellationRequested = vi.fn(() => true);
    let receivedCancellationToken: unknown;
    const projectService = {
      getAISettings: vi.fn(),
      listAIProviders: vi.fn(),
      addAIProvider: vi.fn(),
      deleteAIProvider: vi.fn(),
      getProxySettings: vi.fn(),
      setProxySettings: vi.fn(),
      testAIConnection: vi.fn(),
      aiTranslateSegment: vi.fn(),
      aiRefineSegment: vi.fn(),
      aiTestTranslate: vi.fn(),
      aiTranslateFile: vi.fn(async (_fileId, options) => {
        receivedCancellationToken = options?.cancellationToken;
        return { translated: 0, skipped: 0, failed: 0 };
      }),
    };

    registerAIHandlers({
      ipcMain,
      projectService: projectService as never,
      jobManager: {
        startJob,
        updateProgress,
        getCancellationToken,
        isCancellationRequested,
      } as never,
    });

    const handler = handlers.get(IPC_CHANNELS.ai.translateFile);
    const jobId = handler?.({}, 1, undefined) as string;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCancellationToken).toHaveBeenCalledWith(jobId);
    expect(receivedCancellationToken).toBe(cancellationToken);
    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        progress: 100,
        status: 'cancelled',
        message: 'Cancelled. Partial results kept.',
      }),
    );
    expect(updateProgress).not.toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('passes ai test translate results through without synthesizing fallback prompts', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const projectService = {
      getAISettings: vi.fn(),
      listAIProviders: vi.fn(),
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
      jobManager: {
        startJob: vi.fn(),
        updateProgress: vi.fn(),
        getCancellationToken: vi.fn(() => ({ isCancellationRequested: () => false })),
        isCancellationRequested: vi.fn(() => false),
      } as never,
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
