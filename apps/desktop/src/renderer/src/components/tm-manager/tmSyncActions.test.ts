import { describe, expect, it } from 'vitest';
import type { TMSyncReport } from '../../../../shared/ipc';
import { tmSyncReportMessage } from './tmSyncActions';

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
});
