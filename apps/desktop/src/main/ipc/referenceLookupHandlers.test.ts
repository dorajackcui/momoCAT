import type { Segment } from '@cat/core/models';
import { describe, expect, it, vi } from 'vitest';
import { TM_SYNC_MAPPING_REVIEW_REQUIRED } from '../../shared/ipc';
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
      listTMOptions: vi.fn().mockResolvedValue([{ id: 'main-1' }]),
      createTM: vi.fn().mockResolvedValue('tm-1'),
      renameTM: vi.fn().mockResolvedValue(undefined),
      deleteTM: vi.fn().mockResolvedValue(undefined),
      mountTMToProject: vi.fn().mockResolvedValue(undefined),
      unmountTMFromProject: vi.fn().mockResolvedValue(undefined),
      exportWorkingTM: vi.fn().mockResolvedValue(3),
      resetWorkingTM: vi.fn().mockResolvedValue(3),
      commitFileToTM: vi.fn().mockResolvedValue({
        committedCount: 4,
        projectId: 7,
        tmType: 'main',
      }),
      batchMatchFileWithTM: vi.fn().mockResolvedValue(undefined),
      getTMSyncConfig: vi.fn().mockReturnValue({
        filePath: __filename,
        columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
        columnIdentity: {
          kind: 'headers',
          sourceCol: 0,
          targetCol: 1,
          sourceHeader: 'source',
          targetHeader: 'target',
        },
      }),
      setTMSyncConfig: vi.fn().mockResolvedValue(undefined),
      syncTMEntriesFromExcel: vi.fn().mockResolvedValue({
        fileRows: 1,
        duplicates: 0,
        skipped: 0,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: 1,
        overwrittenLocalEdits: 0,
        deletedLocalEdits: 0,
      }),
      createTB: vi.fn().mockResolvedValue('tb-1'),
      renameTB: vi.fn().mockResolvedValue(undefined),
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

  it('tm-sync-execute requires legacy source/target mappings to be reviewed before a job starts', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.getTMSyncConfig.mockReturnValue({
      filePath: 'D:/tm/main.xlsx',
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    });

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.syncExecute)?.({}, 'tm-1')).resolves.toEqual({
      status: 'mapping-review-required',
      filePath: 'D:/tm/main.xlsx',
      reason: 'The saved source/target mapping must be reviewed before strict sync.',
    });
    expect(deps.jobManager.startJob).not.toHaveBeenCalled();
    expect(deps.projectService.syncTMEntriesFromExcel).not.toHaveBeenCalled();
  });

  it('tm-sync-execute preserves the mapping-review error code from worker preflight', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.syncTMEntriesFromExcel.mockRejectedValue(
      new Error(
        `${TM_SYNC_MAPPING_REVIEW_REQUIRED}: source/target headers changed\nError: worker stack`,
      ),
    );

    registerTMHandlers({ ipcMain, ...deps } as never);

    const result = (await handlers.get(IPC_CHANNELS.tm.syncExecute)?.({}, 'tm-1')) as {
      status: string;
      jobId: string;
    };
    expect(result.status).toBe('started');
    await vi.waitFor(() => {
      expect(deps.jobManager.updateProgress).toHaveBeenCalledWith(
        result.jobId,
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: TM_SYNC_MAPPING_REVIEW_REQUIRED,
            message: 'source/target headers changed',
          }),
        }),
      );
    });
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

  it('serves lightweight TM options without loading manager statistics', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.listOptions)?.({}, 'main')).resolves.toEqual([
      { id: 'main-1' },
    ]);
    expect(deps.projectService.listTMOptions).toHaveBeenCalledWith('main');
  });

  it.each([
    {
      channel: IPC_CHANNELS.tm.create,
      args: ['Main TM', 'en', 'zh', undefined],
      expected: { projectId: null, kind: 'tm', reason: 'tm-created' },
    },
    {
      channel: IPC_CHANNELS.tm.rename,
      args: ['tm-1', 'Renamed TM'],
      expected: { projectId: null, kind: 'tm', reason: 'tm-renamed' },
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
      channel: IPC_CHANNELS.tm.resetWorking,
      args: [7, 'tm-1'],
      expected: { projectId: 7, kind: 'tm', reason: 'working-tm-reset' },
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

  it('exports a Working TM without invalidating reference caches', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(
      handlers.get(IPC_CHANNELS.tm.exportWorking)?.({}, 7, 'tm-1', 'working.xlsx'),
    ).resolves.toBe(3);
    expect(deps.projectService.exportWorkingTM).toHaveBeenCalledWith(7, 'tm-1', 'working.xlsx');
    expect(deps.notifyReferenceDataChanged).not.toHaveBeenCalled();
  });

  it('emits a project-scoped Working TM invalidation after committing a file', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.commitFileToTM.mockResolvedValueOnce({
      committedCount: 2,
      projectId: 7,
      tmType: 'working',
    });

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(
      handlers.get(IPC_CHANNELS.tm.commitFile)?.({}, 'working-1', 11, undefined),
    ).resolves.toBe(2);
    expect(deps.notifyReferenceDataChanged).toHaveBeenCalledWith({
      projectId: 7,
      kind: 'tm',
      reason: 'working-tm-updated',
    });
  });

  it('does not invalidate Working TM references when an atomic file commit fails', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.commitFileToTM.mockRejectedValueOnce(new Error('commit failed'));

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(
      handlers.get(IPC_CHANNELS.tm.commitFile)?.({}, 'working-1', 11, undefined),
    ).rejects.toThrow('commit failed');
    expect(deps.notifyReferenceDataChanged).not.toHaveBeenCalled();
  });

  it('does not invalidate Working TM references when reset fails atomically', async () => {
    const { handlers, ipcMain } = createIpcMainStub();
    const deps = createDeps();
    deps.projectService.resetWorkingTM.mockRejectedValueOnce(new Error('reset failed'));

    registerTMHandlers({ ipcMain, ...deps } as never);

    await expect(handlers.get(IPC_CHANNELS.tm.resetWorking)?.({}, 7, 'working-1')).rejects.toThrow(
      'reset failed',
    );
    expect(deps.notifyReferenceDataChanged).not.toHaveBeenCalled();
  });

  it.each([
    {
      channel: IPC_CHANNELS.tb.create,
      args: ['Main TB', 'en', 'zh'],
      expected: { projectId: null, kind: 'tb', reason: 'tb-created' },
    },
    {
      channel: IPC_CHANNELS.tb.rename,
      args: ['tb-1', 'Renamed TB'],
      expected: { projectId: null, kind: 'tb', reason: 'tb-renamed' },
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
