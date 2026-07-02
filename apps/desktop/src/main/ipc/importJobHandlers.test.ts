import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerTBHandlers } from './tbHandlers';
import { registerTMHandlers } from './tmHandlers';

function createIpcMainStub() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
  };

  return { handlers, ipcMain };
}

describe('import job handlers', () => {
  it('reports tm import success and emits reference invalidation', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const referenceLookup = {
      findTmMatches: vi.fn(),
      findTbMatches: vi.fn(),
      searchConcordance: vi.fn(),
    };
    const notifyReferenceDataChanged = vi.fn();
    const projectService = {
      importTMEntries: vi.fn(async (_tmId, _filePath, _options, onProgress) => {
        onProgress({ current: 2, total: 4, message: 'Halfway' });
        return { success: 3, skipped: 1 };
      }),
    };

    registerTMHandlers({
      ipcMain,
      projectService,
      jobManager: { startJob, updateProgress },
      referenceLookup,
      notifyReferenceDataChanged,
    } as never);

    const handler = handlers.get(IPC_CHANNELS.tm.importExecute);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 'tm-1', '/tmp/sample.xlsx', {
      sourceCol: 0,
      targetCol: 1,
      hasHeader: true,
      overwrite: false,
    }) as string;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        progress: 100,
        status: 'completed',
        result: { kind: 'tm-import', success: 3, skipped: 1 },
      }),
    );
    expect(notifyReferenceDataChanged).toHaveBeenCalledWith({
      projectId: null,
      kind: 'tm',
      reason: 'tm-imported',
    });
  });

  it('returns tm import job id and reports structured failure', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const referenceLookup = {
      findTmMatches: vi.fn(),
      findTbMatches: vi.fn(),
      searchConcordance: vi.fn(),
    };
    const notifyReferenceDataChanged = vi.fn();
    const projectService = {
      importTMEntries: vi.fn(async (_tmId, _filePath, _options, onProgress) => {
        onProgress({ current: 1, total: 2, message: 'Halfway' });
        throw new Error('tm import blew up');
      }),
    };

    registerTMHandlers({
      ipcMain,
      projectService,
      jobManager: { startJob, updateProgress },
      referenceLookup,
      notifyReferenceDataChanged,
    } as never);

    const handler = handlers.get(IPC_CHANNELS.tm.importExecute);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 'tm-1', '/tmp/sample.xlsx', {
      sourceCol: 0,
      targetCol: 1,
      hasHeader: true,
      overwrite: false,
    }) as string;

    expect(typeof jobId).toBe('string');
    expect(startJob).toHaveBeenCalledWith(jobId, 'TM import started');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ progress: 50, message: 'Halfway' }),
    );
    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'TM_IMPORT_FAILED',
          message: 'tm import blew up',
        }),
      }),
    );
    expect(notifyReferenceDataChanged).not.toHaveBeenCalled();
  });

  it('reports tb import success and emits reference invalidation', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const referenceLookup = {
      findTmMatches: vi.fn(),
      findTbMatches: vi.fn(),
      searchConcordance: vi.fn(),
    };
    const notifyReferenceDataChanged = vi.fn();
    const projectService = {
      importTBEntries: vi.fn(async (_tbId, _filePath, _options, onProgress) => {
        onProgress({ current: 2, total: 4, message: 'Halfway' });
        return { success: 5, skipped: 2 };
      }),
    };

    registerTBHandlers({
      ipcMain,
      projectService,
      jobManager: { startJob, updateProgress },
      referenceLookup,
      notifyReferenceDataChanged,
    } as never);

    const handler = handlers.get(IPC_CHANNELS.tb.importExecute);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 'tb-1', '/tmp/sample.xlsx', {
      sourceCol: 0,
      targetCol: 1,
      hasHeader: true,
      overwrite: false,
    }) as string;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        progress: 100,
        status: 'completed',
        result: { kind: 'tb-import', success: 5, skipped: 2 },
      }),
    );
    expect(notifyReferenceDataChanged).toHaveBeenCalledWith({
      projectId: null,
      kind: 'tb',
      reason: 'tb-imported',
    });
  });

  it('returns tb import job id and reports structured failure', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const startJob = vi.fn();
    const updateProgress = vi.fn();
    const referenceLookup = {
      findTmMatches: vi.fn(),
      findTbMatches: vi.fn(),
      searchConcordance: vi.fn(),
    };
    const notifyReferenceDataChanged = vi.fn();
    const projectService = {
      importTBEntries: vi.fn(async (_tbId, _filePath, _options, onProgress) => {
        onProgress({ current: 3, total: 6, message: 'Halfway' });
        throw new Error('tb import blew up');
      }),
    };

    registerTBHandlers({
      ipcMain,
      projectService,
      jobManager: { startJob, updateProgress },
      referenceLookup,
      notifyReferenceDataChanged,
    } as never);

    const handler = handlers.get(IPC_CHANNELS.tb.importExecute);
    expect(handler).toBeDefined();

    const jobId = handler?.({}, 'tb-1', '/tmp/sample.xlsx', {
      sourceCol: 0,
      targetCol: 1,
      hasHeader: true,
      overwrite: false,
    }) as string;

    expect(typeof jobId).toBe('string');
    expect(startJob).toHaveBeenCalledWith(jobId, 'TB import started');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ progress: 50, message: 'Halfway' }),
    );
    expect(updateProgress).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'TB_IMPORT_FAILED',
          message: 'tb import blew up',
        }),
      }),
    );
    expect(notifyReferenceDataChanged).not.toHaveBeenCalled();
  });
});
