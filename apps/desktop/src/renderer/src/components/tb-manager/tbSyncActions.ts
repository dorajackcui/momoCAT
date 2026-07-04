import type {
  DesktopApi,
  DialogFileFilter,
  SpreadsheetPreviewData,
  TBSyncColumns,
  TBSyncStartResult,
  TBWithStats,
} from '../../../../shared/ipc';

export const TB_SPREADSHEET_FILTERS: DialogFileFilter[] = [
  { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] },
];

export interface PickSyncSourceResult {
  filePath: string;
  preview: SpreadsheetPreviewData;
}

export interface PickSyncSourceDeps {
  openFileDialog: DesktopApi['openFileDialog'];
  getTBImportPreview: DesktopApi['getTBImportPreview'];
  error: (message: string) => void;
}

/** Pick the Excel file to bind (create-with-sync and relink share this step). */
export async function pickTBSyncSource(
  deps: PickSyncSourceDeps,
): Promise<PickSyncSourceResult | null> {
  const filePath = await deps.openFileDialog(TB_SPREADSHEET_FILTERS);
  if (!filePath) return null;

  try {
    const preview = await deps.getTBImportPreview(filePath);
    return { filePath, preview };
  } catch {
    deps.error('Failed to read file for preview.');
    return null;
  }
}

export interface ConfirmSyncLinkDeps {
  setTBSyncConfig: DesktopApi['setTBSyncConfig'];
  syncTBWithExcel: DesktopApi['syncTBWithExcel'];
  error: (message: string) => void;
}

/** Save the file binding + column mapping, then start the first sync job. */
export async function confirmTBSyncLink(
  tbId: string,
  filePath: string,
  options: TBSyncColumns,
  deps: ConfirmSyncLinkDeps,
): Promise<TBSyncStartResult | null> {
  try {
    await deps.setTBSyncConfig(tbId, {
      filePath,
      columns: {
        hasHeader: options.hasHeader,
        sourceCol: options.sourceCol,
        targetCol: options.targetCol,
        noteCol: options.noteCol,
      },
    });
    return await deps.syncTBWithExcel(tbId);
  } catch (caught) {
    deps.error(
      `Failed to start sync: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return null;
  }
}

export interface SyncNowDeps {
  syncTBWithExcel: DesktopApi['syncTBWithExcel'];
  confirmRelink: (message: string) => Promise<boolean>;
  error: (message: string) => void;
}

export type SyncNowOutcome =
  | { kind: 'started'; jobId: string }
  | { kind: 'relink-requested' }
  | { kind: 'cancelled' };

/**
 * Run a manual sync. If the bound Excel was moved/renamed/unreadable, ask the
 * user whether to relink instead of failing silently.
 */
export async function runTBSyncNow(tb: TBWithStats, deps: SyncNowDeps): Promise<SyncNowOutcome> {
  let result: TBSyncStartResult;
  try {
    result = await deps.syncTBWithExcel(tb.id);
  } catch (caught) {
    deps.error(`Sync failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return { kind: 'cancelled' };
  }

  if (result.status === 'started') {
    return { kind: 'started', jobId: result.jobId };
  }

  const relink = await deps.confirmRelink(
    `The linked Excel file could not be read:\n${result.filePath}\n\nIt may have been moved, renamed, or deleted. Relink to a new file?`,
  );
  return relink ? { kind: 'relink-requested' } : { kind: 'cancelled' };
}
