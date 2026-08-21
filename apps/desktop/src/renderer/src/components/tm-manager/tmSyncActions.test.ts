import { describe, expect, it, vi } from 'vitest';
import type { TMSyncReport, TMWithStats } from '../../../../shared/ipc';
import { runTMSyncNow, tmSyncReportMessage } from './tmSyncActions';

function tm(): TMWithStats {
  return {
    id: 'tm-1',
    name: 'Main TM',
    srcLang: 'en',
    tgtLang: 'fr',
    type: 'main',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    stats: { entryCount: 2 },
    syncConfig: {
      filePath: 'D:/tm/main.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    },
  };
}

function report(overrides: Partial<TMSyncReport> = {}): TMSyncReport {
  return {
    fileRows: 10,
    duplicates: 0,
    skipped: 0,
    added: 3,
    updated: 2,
    deleted: 1,
    unchanged: 4,
    overwrittenLocalEdits: 0,
    deletedLocalEdits: 0,
    ...overrides,
  };
}

describe('tmSyncReportMessage', () => {
  it('summarizes a plain successful sync', () => {
    expect(tmSyncReportMessage(report())).toBe(
      'Sync completed: 3 added, 2 updated, 1 removed, 4 unchanged.',
    );
  });

  it('appends skipped and duplicate row counts', () => {
    expect(tmSyncReportMessage(report({ skipped: 2, duplicates: 1 }))).toBe(
      'Sync completed: 3 added, 2 updated, 1 removed, 4 unchanged (2 rows skipped, 1 duplicate rows).',
    );
  });

  it('marks cancelled runs as a partial apply', () => {
    expect(tmSyncReportMessage(report({ cancelled: true }))).toContain(
      'Sync cancelled after partial apply:',
    );
  });

  it('warns when locally edited entries were overwritten by the file', () => {
    expect(tmSyncReportMessage(report({ overwrittenLocalEdits: 1 }))).toContain(
      'Warning: 1 locally edited entry overwritten by the file.',
    );
    expect(tmSyncReportMessage(report({ overwrittenLocalEdits: 5, cancelled: true }))).toContain(
      'Warning: 5 locally edited entries overwritten by the file.',
    );
  });

  it('warns when locally edited entries were pruned because they are missing from the file', () => {
    expect(tmSyncReportMessage(report({ deletedLocalEdits: 1 }))).toContain(
      'Warning: 1 locally edited entry deleted because it is missing from the file.',
    );
    const both = tmSyncReportMessage(report({ overwrittenLocalEdits: 2, deletedLocalEdits: 3 }));
    expect(both).toContain('Warning: 2 locally edited entries overwritten by the file.');
    expect(both).toContain(
      'Warning: 3 locally edited entries deleted because they are missing from the file.',
    );
  });
});

describe('runTMSyncNow', () => {
  it('requests remapping when a legacy source/target mapping needs review', async () => {
    const confirmRelink = vi.fn(async () => true);
    const outcome = await runTMSyncNow(tm(), {
      syncTMWithExcel: vi.fn(async () => ({
        status: 'mapping-review-required',
        filePath: 'D:/tm/main.xlsx',
        reason: 'The saved mapping must be reviewed.',
      })),
      confirmRelink,
      error: vi.fn(),
    });

    expect(confirmRelink).toHaveBeenCalledWith(expect.stringContaining('saved mapping'));
    expect(outcome).toEqual({ kind: 'relink-requested' });
  });
});
