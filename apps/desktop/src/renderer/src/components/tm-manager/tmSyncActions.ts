import type {
  DesktopApi,
  DialogFileFilter,
  SpreadsheetPreviewData,
  TMSyncColumns,
  TMSyncReport,
  TMSyncStartResult,
  TMWithStats,
} from '../../../../shared/ipc';

export const TM_SPREADSHEET_FILTERS: DialogFileFilter[] = [
  { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] },
];

export function tmSyncReportMessage(report: TMSyncReport): string {
  const base = `${report.added} added, ${report.updated} updated, ${report.deleted} removed, ${report.unchanged} unchanged`;
  const extras: string[] = [];
  if (report.skipped > 0) extras.push(`${report.skipped} rows skipped`);
  if (report.duplicates > 0) extras.push(`${report.duplicates} duplicate rows`);
  const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  const summary = report.cancelled
    ? `Sync cancelled after partial apply: ${base}${suffix}.`
    : `Sync completed: ${base}${suffix}.`;
  const warnings: string[] = [];
  if (report.overwrittenLocalEdits > 0) {
    const noun = report.overwrittenLocalEdits === 1 ? 'entry' : 'entries';
    warnings.push(
      `Warning: ${report.overwrittenLocalEdits} locally edited ${noun} overwritten by the file.`,
    );
  }
  if (report.deletedLocalEdits > 0) {
    warnings.push(
      report.deletedLocalEdits === 1
        ? 'Warning: 1 locally edited entry deleted because it is missing from the file.'
        : `Warning: ${report.deletedLocalEdits} locally edited entries deleted because they are missing from the file.`,
    );
  }
  return warnings.length > 0 ? `${summary} ${warnings.join(' ')}` : summary;
}

export interface PickTMSyncSourceResult {
  filePath: string;
  preview: SpreadsheetPreviewData;
}

export interface PickTMSyncSourceDeps {
  openFileDialog: DesktopApi['openFileDialog'];
  getTMImportPreview: DesktopApi['getTMImportPreview'];
  error: (message: string) => void;
}

/** Pick the Excel file to bind (create-with-sync and relink share this step). */
export async function pickTMSyncSource(
  deps: PickTMSyncSourceDeps,
): Promise<PickTMSyncSourceResult | null> {
  const filePath = await deps.openFileDialog(TM_SPREADSHEET_FILTERS);
  if (!filePath) return null;

  try {
    const preview = await deps.getTMImportPreview(filePath);
    return { filePath, preview };
  } catch {
    deps.error('Failed to read file for preview.');
    return null;
  }
}

export interface ConfirmTMSyncLinkDeps {
  setTMSyncConfig: DesktopApi['setTMSyncConfig'];
  syncTMWithExcel: DesktopApi['syncTMWithExcel'];
  error: (message: string) => void;
}

/** Save the file binding + column mapping, then start the first sync job. */
export async function confirmTMSyncLink(
  tmId: string,
  filePath: string,
  columns: TMSyncColumns,
  deps: ConfirmTMSyncLinkDeps,
): Promise<TMSyncStartResult | null> {
  try {
    await deps.setTMSyncConfig(tmId, {
      filePath,
      columns: {
        hasHeader: columns.hasHeader,
        sourceCol: columns.sourceCol,
        targetCol: columns.targetCol,
      },
    });
    return await deps.syncTMWithExcel(tmId);
  } catch (caught) {
    deps.error(
      `Failed to start sync: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return null;
  }
}

export interface TMSyncNowDeps {
  syncTMWithExcel: DesktopApi['syncTMWithExcel'];
  confirmRelink: (message: string) => Promise<boolean>;
  error: (message: string) => void;
}

export type TMSyncNowOutcome =
  | { kind: 'started'; jobId: string }
  | { kind: 'relink-requested' }
  | { kind: 'cancelled' };

/**
 * Run a manual sync. If the bound Excel was moved/renamed/unreadable, ask the
 * user whether to relink instead of failing silently.
 */
export async function runTMSyncNow(
  tm: TMWithStats,
  deps: TMSyncNowDeps,
): Promise<TMSyncNowOutcome> {
  let result: TMSyncStartResult;
  try {
    result = await deps.syncTMWithExcel(tm.id);
  } catch (caught) {
    deps.error(`Sync failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return { kind: 'cancelled' };
  }

  if (result.status === 'started') {
    return { kind: 'started', jobId: result.jobId };
  }

  const message =
    result.status === 'file-missing'
      ? `The linked Excel file could not be read:\n${result.filePath}\n\nIt may have been moved, renamed, or deleted. Relink to a new file?`
      : `${result.reason}\n\nLinked file: ${result.filePath}\n\nReview the source/target mapping now?`;
  const relink = await deps.confirmRelink(message);
  return relink ? { kind: 'relink-requested' } : { kind: 'cancelled' };
}
