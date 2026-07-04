import type { Segment } from '@cat/core/models';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerTBHandlers } from './tbHandlers';
import { registerTMHandlers } from './tmHandlers';
import type { IpcMainListener } from './types';

function createIpcMainStub() {
  const handlers = new Map<string, IpcMainListener>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: IpcMainListener) => {
      handlers.set(channel, listener);
    }),
  };

  return { handlers, ipcMain };
}

function createSegment(source = 'Hello world'): Segment {
  return {
    id: 1,
    fileId: 1,
    unitId: 'u1',
    index: 0,
    source,
    target: '',
    status: 'new',
    locked: false,
  } as unknown as Segment;
}

function createDeps() {
  return {
    projectService: {
      findMatches: vi.fn(),
      findTermMatches: vi.fn(),
      searchConcordance: vi.fn(),
      createTM: vi.fn().mockResolvedValue('tm-1'),
      deleteTM: vi.fn().mockResolvedValue(undefined),
      mountTMToProject: vi.fn().mockResolvedValue(undefined),
      unmountTMFromProject: vi.fn().mockResolvedValue(undefined),
      commitToMainTM: vi.fn().mockResolvedValue(undefined),
      batchMatchFileWithTM: vi.fn().mockResolvedValue(undefined),
      createTB: vi.fn().mockResolvedValue('tb-1'),
      deleteTB: vi.fn().mockResolvedValue(undefined),
      mountTBToProject: vi.fn().mockResolvedValue(undefined),
      unmountTBFromProject: vi.fn().mockResolvedValue(undefined),
      getTBSyncConfig: vi.fn().mockReturnValue({
        filePath: 'D:/terms/glossary.xlsx',
        columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
      }),
      setTBSyncConfig: vi.fn().mockResolvedValue(undefined),
      syncTBEntriesFromExcel: vi.fn().mockResolvedValue({ success: 2, skipped: 0, removed: 1 }),
    },
    jobManager: {
      startJob: vi.fn(),
      updateProgress: vi.fn(),
    },
    referenceLookup: {
      findTmMatches: vi.fn().mockResolvedValue([{ id: 'tm-match' }]),
      findTbMatches: vi.fn().mockResolvedValue([{ id: 'tb-match' }]),
      searchConcordance: vi.fn().mockResolvedValue([{ id: 'concordance-match' }]),
    },
    referenceLookupPrefetch: {
      findTmMatches: vi.fn().mockResolvedValue([{ id: 'tm-prefetch-match' }]),
      findTbMatches: vi.fn().mockResolvedValue([{ id: 'tb-prefetch-match' }]),
      searchConcordance: vi.fn().mockResolvedValue([]),
    },
    notifyReferenceDataChanged: vi.fn(),
  };
}

describe('reference lookup IPC handlers', () => {
  it('delegates TM matches to referenceLookup instead of projectService', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    const segment = createSegment();

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.getMatches)?.({}, 7, segment)).resolves.toEqual([
      { id: 'tm-match' },
    ]);
    expect(deps.referenceLookup.findTmMatches).toHaveBeenCalledWith(7, segment);
    expect(deps.projectService.findMatches).not.toHaveBeenCalled();
  });

  it('delegates TB matches to referenceLookup instead of projectService', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    const segment = createSegment();

    registerTBHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tb.getMatches)?.({}, 7, segment)).resolves.toEqual([
      { id: 'tb-match' },
    ]);
    expect(deps.referenceLookup.findTbMatches).toHaveBeenCalledWith(7, segment);
    expect(deps.projectService.findTermMatches).not.toHaveBeenCalled();
  });

  it('delegates TM prefetch to the dedicated prefetch service, not the active one', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    const segment = createSegment();

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.prefetch)?.({}, 7, segment)).resolves.toEqual([
      { id: 'tm-prefetch-match' },
    ]);
    expect(deps.referenceLookupPrefetch.findTmMatches).toHaveBeenCalledWith(7, segment);
    expect(deps.referenceLookup.findTmMatches).not.toHaveBeenCalled();
  });

  it('delegates TB prefetch to the dedicated prefetch service, not the active one', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    const segment = createSegment();

    registerTBHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tb.prefetch)?.({}, 7, segment)).resolves.toEqual([
      { id: 'tb-prefetch-match' },
    ]);
    expect(deps.referenceLookupPrefetch.findTbMatches).toHaveBeenCalledWith(7, segment);
    expect(deps.referenceLookup.findTbMatches).not.toHaveBeenCalled();
  });

  it('delegates TM concordance to referenceLookup instead of projectService', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.concordance)?.({}, 7, 'query')).resolves.toEqual([
      { id: 'concordance-match' },
    ]);
    expect(deps.referenceLookup.searchConcordance).toHaveBeenCalledWith(7, 'query');
    expect(deps.projectService.searchConcordance).not.toHaveBeenCalled();
  });

  it.each([
    {
      channel: IPC_CHANNELS.tm.create,
      args: ['Main TM', 'en', 'zh', undefined],
      expected: { projectId: null, kind: 'tm', reason: 'tm-created' },
    },
    {
      channel: IPC_CHANNELS.tm.remove,
      args: ['tm-1'],
      expected: { projectId: null, kind: 'tm', reason: 'tm-deleted' },
    },
    {
      channel: IPC_CHANNELS.tm.mount,
      args: [7, 'tm-1', 1, 'read-write'],
      expected: { projectId: 7, kind: 'tm', reason: 'tm-mounted' },
    },
    {
      channel: IPC_CHANNELS.tm.unmount,
      args: [7, 'tm-1'],
      expected: { projectId: 7, kind: 'tm', reason: 'tm-unmounted' },
    },
    {
      channel: IPC_CHANNELS.tm.commitFile,
      args: ['tm-1', 11, undefined],
      expected: { projectId: null, kind: 'tm', reason: 'tm-committed' },
    },
    {
      channel: IPC_CHANNELS.tm.matchFile,
      args: [11, 'tm-1'],
      expected: { projectId: null, kind: 'tm', reason: 'tm-batch-matched' },
    },
  ])(
    'emits reference invalidation after successful $channel',
    async ({ channel, args, expected }) => {
      const { handlers, ipcMain } = createIpcMainStub();
      const deps = createDeps();

      registerTMHandlers({ ipcMain, ...deps } as never);

      await handlers.get(channel)?.({}, ...args);
      expect(deps.notifyReferenceDataChanged).toHaveBeenCalledWith(expected);
    },
  );

  it.each([
    {
      channel: IPC_CHANNELS.tb.create,
      args: ['Main TB', 'en', 'zh'],
      expected: { projectId: null, kind: 'tb', reason: 'tb-created' },
    },
    {
      channel: IPC_CHANNELS.tb.remove,
      args: ['tb-1'],
      expected: { projectId: null, kind: 'tb', reason: 'tb-deleted' },
    },
    {
      channel: IPC_CHANNELS.tb.mount,
      args: [7, 'tb-1', 1],
      expected: { projectId: 7, kind: 'tb', reason: 'tb-mounted' },
    },
    {
      channel: IPC_CHANNELS.tb.unmount,
      args: [7, 'tb-1'],
      expected: { projectId: 7, kind: 'tb', reason: 'tb-unmounted' },
    },
  ])(
    'emits reference invalidation after successful $channel',
    async ({ channel, args, expected }) => {
      const { handlers, ipcMain } = createIpcMainStub();
      const deps = createDeps();

      registerTBHandlers({ ipcMain, ...deps } as never);

      await handlers.get(channel)?.({}, ...args);
      expect(deps.notifyReferenceDataChanged).toHaveBeenCalledWith(expected);
    },
  );

  it('tb-sync-set-config delegates to projectService.setTBSyncConfig', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    const config = {
      filePath: 'D:/terms/glossary.xlsx',
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    };

    registerTBHandlers({ ipcMain, ...deps } as never);

    await handlers.get(IPC_CHANNELS.tb.syncSetConfig)?.({}, 'tb-1', config);
    expect(deps.projectService.setTBSyncConfig).toHaveBeenCalledWith('tb-1', config);
  });

  it('tb-sync-execute returns file-missing without starting a job when the bound file is unreadable', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.getTBSyncConfig.mockReturnValue({
      filePath: 'D:/definitely-missing/glossary.xlsx',
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    });

    registerTBHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tb.syncExecute)?.({}, 'tb-1')).resolves.toEqual({
      status: 'file-missing',
      filePath: 'D:/definitely-missing/glossary.xlsx',
    });
    expect(deps.jobManager.startJob).not.toHaveBeenCalled();
    expect(deps.projectService.syncTBEntriesFromExcel).not.toHaveBeenCalled();
  });

  it('tb-sync-execute starts a job and emits tb-synced invalidation on success', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    // Point the binding at a file that exists so the access() precheck passes.
    deps.projectService.getTBSyncConfig.mockReturnValue({
      filePath: __filename,
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    });

    registerTBHandlers({ ipcMain, ...deps } as never);

    const result = (await handlers.get(IPC_CHANNELS.tb.syncExecute)?.({}, 'tb-1')) as {
      status: string;
      jobId: string;
    };
    expect(result.status).toBe('started');
    expect(result.jobId).toBeTruthy();
    expect(deps.jobManager.startJob).toHaveBeenCalledWith(result.jobId, 'TB sync started');

    await vi.waitFor(() => {
      expect(deps.projectService.syncTBEntriesFromExcel).toHaveBeenCalledWith(
        'tb-1',
        expect.any(Function),
      );
      expect(deps.jobManager.updateProgress).toHaveBeenCalledWith(
        result.jobId,
        expect.objectContaining({
          status: 'completed',
          result: { kind: 'tb-sync', success: 2, skipped: 0 },
        }),
      );
      expect(deps.notifyReferenceDataChanged).toHaveBeenCalledWith({
        projectId: null,
        kind: 'tb',
        reason: 'tb-synced',
      });
    });
  });

  it('tb-sync-execute marks the job failed when the sync throws', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.getTBSyncConfig.mockReturnValue({
      filePath: __filename,
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    });
    deps.projectService.syncTBEntriesFromExcel.mockRejectedValue(new Error('boom'));

    registerTBHandlers({ ipcMain, ...deps } as never);

    const result = (await handlers.get(IPC_CHANNELS.tb.syncExecute)?.({}, 'tb-1')) as {
      status: string;
      jobId: string;
    };
    expect(result.status).toBe('started');

    await vi.waitFor(() => {
      expect(deps.jobManager.updateProgress).toHaveBeenCalledWith(
        result.jobId,
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'TB_SYNC_FAILED', message: 'boom' }),
        }),
      );
    });
    expect(deps.notifyReferenceDataChanged).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'tb-synced' }),
    );
  });
});
