import { describe, expect, it, vi } from 'vitest';
import {
  confirmTBSyncLink,
  pickTBSyncSource,
  runTBSyncNow,
  TB_SPREADSHEET_FILTERS,
} from './tbSyncActions';
import type { TBWithStats } from '../../../../shared/ipc';

function makeTB(overrides?: Partial<TBWithStats>): TBWithStats {
  return {
    id: 'tb-1',
    name: 'Glossary',
    srcLang: 'en',
    tgtLang: 'fr',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    stats: { entryCount: 2 },
    syncConfig: {
      filePath: 'D:/terms/glossary.xlsx',
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    },
    ...overrides,
  };
}

describe('pickTBSyncSource', () => {
  it('returns the picked file with its preview', async () => {
    const openFileDialog = vi.fn(async () => 'D:/terms/glossary.xlsx');
    const getTBImportPreview = vi.fn(async () => [['source', 'target']]);
    const error = vi.fn();

    const result = await pickTBSyncSource({ openFileDialog, getTBImportPreview, error });

    expect(openFileDialog).toHaveBeenCalledWith(TB_SPREADSHEET_FILTERS);
    expect(result).toEqual({
      filePath: 'D:/terms/glossary.xlsx',
      preview: [['source', 'target']],
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('returns null when the dialog is cancelled', async () => {
    const getTBImportPreview = vi.fn();
    const result = await pickTBSyncSource({
      openFileDialog: vi.fn(async () => null),
      getTBImportPreview,
      error: vi.fn(),
    });

    expect(result).toBeNull();
    expect(getTBImportPreview).not.toHaveBeenCalled();
  });

  it('reports an error when the preview cannot be read', async () => {
    const error = vi.fn();
    const result = await pickTBSyncSource({
      openFileDialog: vi.fn(async () => 'D:/terms/corrupt.xlsx'),
      getTBImportPreview: vi.fn(async () => {
        throw new Error('bad file');
      }),
      error,
    });

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledWith('Failed to read file for preview.');
  });
});

describe('confirmTBSyncLink', () => {
  it('saves the binding and starts the sync job', async () => {
    const setTBSyncConfig = vi.fn(async () => undefined);
    const syncTBWithExcel = vi.fn(async () => ({ status: 'started', jobId: 'job-1' }) as const);

    const result = await confirmTBSyncLink(
      'tb-1',
      'D:/terms/glossary.xlsx',
      { hasHeader: true, sourceCol: 0, targetCol: 1, noteCol: 2 },
      { setTBSyncConfig, syncTBWithExcel, error: vi.fn() },
    );

    expect(setTBSyncConfig).toHaveBeenCalledWith('tb-1', {
      filePath: 'D:/terms/glossary.xlsx',
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1, noteCol: 2 },
    });
    expect(result).toEqual({ status: 'started', jobId: 'job-1' });
  });

  it('reports an error and returns null when saving fails', async () => {
    const error = vi.fn();
    const syncTBWithExcel = vi.fn();

    const result = await confirmTBSyncLink(
      'tb-1',
      'D:/terms/glossary.xlsx',
      { hasHeader: true, sourceCol: 0, targetCol: 1 },
      {
        setTBSyncConfig: vi.fn(async () => {
          throw new Error('db locked');
        }),
        syncTBWithExcel,
        error,
      },
    );

    expect(result).toBeNull();
    expect(syncTBWithExcel).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Failed to start sync: db locked');
  });
});

describe('runTBSyncNow', () => {
  it('returns the job id when the sync starts', async () => {
    const outcome = await runTBSyncNow(makeTB(), {
      syncTBWithExcel: vi.fn(async () => ({ status: 'started', jobId: 'job-9' }) as const),
      confirmRelink: vi.fn(),
      error: vi.fn(),
    });

    expect(outcome).toEqual({ kind: 'started', jobId: 'job-9' });
  });

  it('asks for a relink when the bound file is missing and the user accepts', async () => {
    const confirmRelink = vi.fn(async () => true);
    const outcome = await runTBSyncNow(makeTB(), {
      syncTBWithExcel: vi.fn(
        async () => ({ status: 'file-missing', filePath: 'D:/terms/glossary.xlsx' }) as const,
      ),
      confirmRelink,
      error: vi.fn(),
    });

    expect(confirmRelink).toHaveBeenCalledWith(expect.stringContaining('D:/terms/glossary.xlsx'));
    expect(outcome).toEqual({ kind: 'relink-requested' });
  });

  it('cancels when the user declines the relink prompt', async () => {
    const outcome = await runTBSyncNow(makeTB(), {
      syncTBWithExcel: vi.fn(
        async () => ({ status: 'file-missing', filePath: 'D:/terms/glossary.xlsx' }) as const,
      ),
      confirmRelink: vi.fn(async () => false),
      error: vi.fn(),
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
  });

  it('reports unexpected sync errors', async () => {
    const error = vi.fn();
    const outcome = await runTBSyncNow(makeTB(), {
      syncTBWithExcel: vi.fn(async () => {
        throw new Error('ipc broke');
      }),
      confirmRelink: vi.fn(),
      error,
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(error).toHaveBeenCalledWith('Sync failed: ipc broke');
  });
});
