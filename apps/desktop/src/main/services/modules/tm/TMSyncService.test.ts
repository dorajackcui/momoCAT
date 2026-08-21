import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsRepository, TMRepository } from '../../ports';
import { TMSyncService } from './TMSyncService';

function fakeSettingsRepo(): SettingsRepository {
  const store = new Map<string, string>();
  return {
    getSetting: (key) => store.get(key),
    setSetting: (key, value) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    },
  };
}

function fakeTMRepo(existingTmIds: string[]): TMRepository {
  return {
    getTM: vi.fn((tmId: string) =>
      existingTmIds.includes(tmId)
        ? {
            id: tmId,
            name: 'TM',
            srcLang: 'en',
            tgtLang: 'fr',
            type: 'main' as const,
            createdAt: '',
            updatedAt: '',
          }
        : undefined,
    ),
  } as unknown as TMRepository;
}

function createService(existingTmIds: string[] = ['tm-1']) {
  const settingsRepo = fakeSettingsRepo();
  const resolveColumnIdentity = vi.fn(async (_filePath, columns) =>
    columns.hasHeader
      ? ({
          kind: 'headers',
          sourceCol: columns.sourceCol,
          targetCol: columns.targetCol,
          sourceHeader: 'source',
          targetHeader: 'target',
        } as const)
      : ({
          kind: 'positions',
          sourceCol: columns.sourceCol,
          targetCol: columns.targetCol,
        } as const),
  );
  const service = new TMSyncService(
    fakeTMRepo(existingTmIds),
    settingsRepo,
    ':memory:',
    vi.fn(),
    resolveColumnIdentity,
  );
  return { service, settingsRepo };
}

describe('TMSyncService config management', () => {
  it('round-trips the strict-mirror sync config', async () => {
    const { service } = createService();

    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    expect(service.getTMSyncConfig('tm-1')).toEqual({
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      columnIdentity: {
        kind: 'headers',
        sourceCol: 0,
        targetCol: 1,
        sourceHeader: 'source',
        targetHeader: 'target',
      },
    });
  });

  it('relinking to a new file clears old sync history and legacy delete policy', async () => {
    const { service, settingsRepo } = createService();
    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/old.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
        deletePolicy: 'never',
        lastSyncedAt: '2026-07-01T00:00:00.000Z',
        lastSyncStatus: 'success',
      }),
    );

    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/data/new.xlsx',
      columns: { sourceCol: 2, targetCol: 3, hasHeader: false },
    });

    // Old sync history and the retired non-mirroring policy do not carry over.
    expect(service.getTMSyncConfig('tm-1')).toEqual({
      filePath: 'C:/data/new.xlsx',
      columns: { sourceCol: 2, targetCol: 3, hasHeader: false },
      columnIdentity: { kind: 'positions', sourceCol: 2, targetCol: 3 },
    });
  });

  it('changing the saved mapping clears old sync history and legacy delete policy', async () => {
    const { service, settingsRepo } = createService();
    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
        deletePolicy: 'never',
        lastSyncedAt: '2026-07-01T00:00:00.000Z',
        lastSyncStatus: 'success',
      }),
    );

    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 2, hasHeader: true },
    });

    expect(service.getTMSyncConfig('tm-1')).toEqual({
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 2, hasHeader: true },
      columnIdentity: {
        kind: 'headers',
        sourceCol: 0,
        targetCol: 2,
        sourceHeader: 'source',
        targetHeader: 'target',
      },
    });
  });

  it('re-saving the exact reviewed binding keeps sync history', async () => {
    const { service, settingsRepo } = createService();
    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
        columnIdentity: {
          kind: 'headers',
          sourceCol: 0,
          targetCol: 1,
          sourceHeader: 'source',
          targetHeader: 'target',
        },
        lastSyncedAt: '2026-07-01T00:00:00.000Z',
        lastSyncStatus: 'success',
      }),
    );

    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    expect(service.getTMSyncConfig('tm-1')).toMatchObject({
      lastSyncedAt: '2026-07-01T00:00:00.000Z',
      lastSyncStatus: 'success',
    });
  });

  it('rejects same-column and invalid column mappings', async () => {
    const { service } = createService();

    await expect(
      service.setTMSyncConfig('tm-1', {
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 1, targetCol: 1, hasHeader: true },
      }),
    ).rejects.toThrow('must be different');

    await expect(
      service.setTMSyncConfig('tm-1', {
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: -1, targetCol: 1, hasHeader: true },
      }),
    ).rejects.toThrow('nonnegative integers');

    await expect(
      service.setTMSyncConfig('tm-1', {
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0.5, targetCol: 1, hasHeader: true },
      }),
    ).rejects.toThrow('nonnegative integers');

    await expect(
      service.setTMSyncConfig('tm-1', {
        filePath: '   ',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      }),
    ).rejects.toThrow('file path is required');

    expect(service.getTMSyncConfig('tm-1')).toBeNull();
  });

  it('rejects configs for unknown TMs and returns null for malformed configs', async () => {
    const { service, settingsRepo } = createService();

    await expect(
      service.setTMSyncConfig('missing', {
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      }),
    ).rejects.toThrow('Target TM not found');

    settingsRepo.setSetting('tm-sync-config:tm-1', 'not-json');
    expect(service.getTMSyncConfig('tm-1')).toBeNull();

    settingsRepo.setSetting('tm-sync-config:tm-1', JSON.stringify({ columns: {} }));
    expect(service.getTMSyncConfig('tm-1')).toBeNull();
  });

  it('fails closed when a stored mapping is invalid or predates column identity', () => {
    const { service, settingsRepo } = createService();
    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 0, hasHeader: true },
      }),
    );
    expect(service.getSyncStartIssue('tm-1')).toContain('must be different');

    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      }),
    );
    expect(service.getSyncStartIssue('tm-1')).toContain('must be reviewed');

    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 8, targetCol: 9, hasHeader: false },
        columnIdentity: { kind: 'positions', sourceCol: 0, targetCol: 1 },
      }),
    );
    expect(service.getSyncStartIssue('tm-1')).toContain('positions changed');

    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath: 'C:/data/tm.xlsx',
        columns: { sourceCol: 0, targetCol: 1, hasHeader: false },
        columnIdentity: { kind: 'positions', sourceCol: 0, targetCol: 1 },
      }),
    );
    expect(service.getSyncStartIssue('tm-1')).toContain('before every strict sync');
  });

  it('consumes a headerless mapping review when the next sync starts', async () => {
    const { service } = createService();
    const root = await mkdtemp(join(tmpdir(), 'cat-tm-sync-headerless-'));
    const filePath = join(root, 'tm.csv');
    await writeFile(filePath, 'Hello,Bonjour\n');

    await service.setTMSyncConfig('tm-1', {
      filePath,
      columns: { sourceCol: 0, targetCol: 1, hasHeader: false },
    });
    expect(service.getSyncStartIssue('tm-1')).toBeNull();

    // The source build has no compiled worker, but reaching worker resolution
    // is enough to consume this one-use manual review.
    await expect(service.syncTMEntriesFromExcel('tm-1')).rejects.toThrow(
      'TM sync worker not found',
    );
    expect(service.getSyncStartIssue('tm-1')).toContain('before every strict sync');

    await service.setTMSyncConfig('tm-1', {
      filePath,
      columns: { sourceCol: 0, targetCol: 1, hasHeader: false },
    });
    expect(service.getSyncStartIssue('tm-1')).toBeNull();
  });

  it('clearTMSyncConfig removes the stored config', async () => {
    const { service } = createService();
    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/data/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    service.clearTMSyncConfig('tm-1');
    expect(service.getTMSyncConfig('tm-1')).toBeNull();
  });

  it('rejects sync for a TM without a binding and records nothing', async () => {
    const { service } = createService();
    await expect(service.syncTMEntriesFromExcel('tm-1')).rejects.toThrow(
      'not bound to a local Excel file',
    );
    expect(service.getTMSyncConfig('tm-1')).toBeNull();
  });

  it('records a failed outcome when the bound file is unreadable', async () => {
    const { service } = createService();
    await service.setTMSyncConfig('tm-1', {
      filePath: 'C:/definitely/missing/tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    await expect(service.syncTMEntriesFromExcel('tm-1')).rejects.toThrow();

    // The missing-file precheck fails before any worker is spawned, so no
    // outcome fields are written for it (the IPC layer reports file-missing
    // separately before starting a job).
    expect(service.getTMSyncConfig('tm-1')?.lastSyncStatus).toBeUndefined();
  });

  it('cancelSync returns false when no sync is running', () => {
    const { service } = createService();
    expect(service.cancelSync('tm-1')).toBe(false);
  });

  it('accepts a cancel during the startup window and cleans up when the run ends', async () => {
    const { service } = createService();
    // A readable file so the sync survives the precheck; the run then fails at
    // worker resolution (no compiled tmSyncWorker.js under src in tests).
    const root = await mkdtemp(join(tmpdir(), 'cat-tm-sync-service-'));
    const filePath = join(root, 'tm.xlsx');
    await writeFile(filePath, 'placeholder');
    await service.setTMSyncConfig('tm-1', {
      filePath,
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    const syncPromise = service.syncTMEntriesFromExcel('tm-1');
    // The sync is claimed synchronously, so a cancel in the startup window
    // (before any worker exists) is accepted instead of dropped.
    expect(service.cancelSync('tm-1')).toBe(true);

    await expect(syncPromise).rejects.toThrow('TM sync worker not found');
    // In-flight bookkeeping is released once the run settles.
    expect(service.cancelSync('tm-1')).toBe(false);
  });

  it('a failed run keeps the lastSyncedAt baseline and records the attempt separately', async () => {
    const { service, settingsRepo } = createService();
    const root = await mkdtemp(join(tmpdir(), 'cat-tm-sync-service-'));
    const filePath = join(root, 'tm.xlsx');
    await writeFile(filePath, 'placeholder');
    // A prior full success established the overwrittenLocalEdits baseline.
    settingsRepo.setSetting(
      'tm-sync-config:tm-1',
      JSON.stringify({
        filePath,
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
        deletePolicy: 'never',
        columnIdentity: {
          kind: 'headers',
          sourceCol: 0,
          targetCol: 1,
          sourceHeader: 'source',
          targetHeader: 'target',
        },
        lastSyncedAt: '2026-07-01T00:00:00.000Z',
        lastSyncStatus: 'success',
      }),
    );

    // Fails at worker resolution (no compiled tmSyncWorker.js under src).
    await expect(service.syncTMEntriesFromExcel('tm-1')).rejects.toThrow(
      'TM sync worker not found',
    );

    const config = service.getTMSyncConfig('tm-1');
    expect(config?.lastSyncStatus).toBe('failed');
    expect(config?.lastSyncError).toBeTruthy();
    // The baseline must not move: the failed run applied nothing (or only a
    // prefix), so local edits must still count against the last full success.
    expect(config?.lastSyncedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(config?.lastSyncAttemptedAt).toBeTruthy();
    expect(config?.lastSyncAttemptedAt).not.toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects a second sync for the same TM while one is in flight', async () => {
    const { service } = createService();
    const root = await mkdtemp(join(tmpdir(), 'cat-tm-sync-service-'));
    const filePath = join(root, 'tm.xlsx');
    await writeFile(filePath, 'placeholder');
    await service.setTMSyncConfig('tm-1', {
      filePath,
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    });

    const first = service.syncTMEntriesFromExcel('tm-1');
    await expect(service.syncTMEntriesFromExcel('tm-1')).rejects.toThrow(
      'A sync for this TM is already running.',
    );
    await expect(first).rejects.toThrow('TM sync worker not found');
  });
});
