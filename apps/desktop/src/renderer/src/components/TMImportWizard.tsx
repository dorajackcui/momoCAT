import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { Button, Card, IconButton, Select, Spinner } from './ui';
import type {
  ImportExecutionResult,
  JobProgressEvent,
  SpreadsheetPreviewData,
  StructuredJobError,
  TMImportOptions,
  TMSyncReport,
} from '../../../shared/ipc';

export type TMWizardMode = 'import' | 'sync';

interface TMImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: TMImportOptions) => void;
  jobId: string | null;
  onJobCompleted: (result: ImportExecutionResult, report?: TMSyncReport) => void;
  onJobFailed: (error: StructuredJobError) => void;
  previewData: SpreadsheetPreviewData;
  mode?: TMWizardMode;
  onCancelSync?: () => void;
}

const WIZARD_COPY: Record<
  TMWizardMode,
  {
    title: string;
    subtitle: string;
    confirmLabel: string;
    progressTitle: string;
    failCode: string;
  }
> = {
  import: {
    title: 'Import TM from File',
    subtitle: 'Map columns and configure import filters',
    confirmLabel: 'Start Import',
    progressTitle: 'Importing TM...',
    failCode: 'TM_IMPORT_FAILED',
  },
  sync: {
    title: 'Sync with Excel',
    subtitle: 'Map columns once. Each sync mirrors this Excel file into the TM.',
    confirmLabel: 'Save & Sync',
    progressTitle: 'Syncing TM...',
    failCode: 'TM_SYNC_FAILED',
  },
};

export function TMImportWizard({
  isOpen,
  onClose,
  onConfirm,
  jobId,
  onJobCompleted,
  onJobFailed,
  previewData,
  mode = 'import',
  onCancelSync,
}: TMImportWizardProps) {
  const [hasHeader, setHasHeader] = useState(true);
  const [sourceCol, setSourceCol] = useState(0);
  const [targetCol, setTargetCol] = useState(1);
  const [overwrite, setOverwrite] = useState(false);
  const [jobProgress, setJobProgress] = useState<JobProgressEvent | null>(null);
  // Keyed by job id so a new job renders un-cancelled without an effect reset.
  const [cancelClickedJobId, setCancelClickedJobId] = useState<string | null>(null);
  const terminalStateHandledRef = useRef(false);
  const cancelRequested =
    (jobId !== null && cancelClickedJobId === jobId) || jobProgress?.cancelRequested === true;

  useEffect(() => {
    terminalStateHandledRef.current = false;
    // Reset per-job progress state immediately when a new job id is assigned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobProgress(null);
  }, [jobId]);

  useEffect(() => {
    if (!isOpen || !jobId) return undefined;

    let active = true;

    const handleProgress = (progress: JobProgressEvent) => {
      if (progress.jobId !== jobId) return;
      setJobProgress(progress);

      if (terminalStateHandledRef.current) return;

      if (progress.status === 'completed' || progress.status === 'cancelled') {
        terminalStateHandledRef.current = true;
        if (progress.result?.kind === 'tm-import' || progress.result?.kind === 'tm-sync') {
          onJobCompleted(
            {
              success: progress.result.success,
              skipped: progress.result.skipped,
            },
            progress.result.report,
          );
        } else {
          onJobCompleted({ success: 0, skipped: 0 });
        }
      }

      if (progress.status === 'failed') {
        terminalStateHandledRef.current = true;
        onJobFailed(
          progress.error ?? {
            code: WIZARD_COPY[mode].failCode,
            message: progress.message || 'TM job failed',
          },
        );
      }
    };

    const unsubscribe = apiClient.onJobProgress(handleProgress);

    // A job started before this modal subscribed (e.g. "Sync now" kicks the job
    // off, then opens the modal) may have already emitted its terminal event.
    // Replay the last known state so the modal never sticks on "Starting...".
    void apiClient.getJobStatus(jobId).then((snapshot) => {
      if (active && snapshot && !terminalStateHandledRef.current) {
        handleProgress(snapshot);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [isOpen, jobId, mode, onJobCompleted, onJobFailed]);

  if (!isOpen) return null;

  const copy = WIZARD_COPY[mode];
  const maxCols = previewData.length > 0 ? previewData[0].length : 0;
  const colIndexes = Array.from({ length: maxCols }, (_, i) => i);
  const sameColumnSelected = sourceCol === targetCol;

  if (jobId) {
    const progress = jobProgress?.progress ?? 0;
    const clampedProgress = Math.max(0, Math.min(progress, 100));
    const progressMessage = jobProgress?.message || 'Starting...';

    return (
      <div className="modal-backdrop !z-[100]">
        <div className="modal-card max-w-md p-8 text-center animate-in fade-in zoom-in duration-200">
          <div className="mb-6">
            <div className="w-16 h-16 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-4">
              <Spinner size="lg" tone="brand" />
            </div>
            <h2 className="text-xl font-bold text-text">{copy.progressTitle}</h2>
            <p className="text-sm text-text-muted mt-1">{progressMessage}</p>
          </div>

          <div className="relative pt-1">
            <div className="flex mb-2 items-center justify-between">
              <span className="badge badge-brand">Progress</span>
              <span className="text-xs font-semibold inline-block text-brand">
                {clampedProgress}%
              </span>
            </div>
            <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-brand-soft">
              <div
                style={{ width: `${clampedProgress}%` }}
                className="shadow-none flex flex-col text-center whitespace-nowrap text-brand-contrast justify-center bg-brand transition-all duration-300"
              />
            </div>
            <p className="text-[10px] text-text-faint font-medium">Job ID: {jobId}</p>
          </div>

          {mode === 'sync' && onCancelSync && (
            <div className="mt-6">
              <Button
                onClick={() => {
                  setCancelClickedJobId(jobId);
                  onCancelSync();
                }}
                variant="secondary"
                disabled={cancelRequested}
              >
                {cancelRequested ? 'Stopping...' : 'Cancel Sync'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop !z-[100]">
      <div className="modal-card max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="panel-header px-8 py-6 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-text">{copy.title}</h2>
            <p className="text-sm text-text-muted mt-1">{copy.subtitle}</p>
          </div>
          <IconButton onClick={onClose} tone="neutral" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="space-y-2">
              <label className="text-sm font-bold text-text-muted flex items-center gap-2">
                <span className="w-2 h-2 bg-brand rounded-full"></span>
                Source Text Column (原文)
              </label>
              <Select
                value={sourceCol}
                onChange={(e) => setSourceCol(parseInt(e.target.value, 10))}
                className="!p-2.5"
              >
                {colIndexes.map((i) => (
                  <option key={i} value={i}>
                    Column {XLSX_COL_NAME(i)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-text-muted flex items-center gap-2">
                <span className="w-2 h-2 bg-success rounded-full"></span>
                Target Text Column (译文)
              </label>
              <Select
                value={targetCol}
                onChange={(e) => setTargetCol(parseInt(e.target.value, 10))}
                className="!p-2.5"
              >
                {colIndexes.map((i) => (
                  <option key={i} value={i}>
                    Column {XLSX_COL_NAME(i)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card
              variant="subtle"
              className="flex items-center gap-3 p-4 border-brand/20 bg-brand-soft/50"
            >
              <input
                type="checkbox"
                id="hasHeader"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <label
                htmlFor="hasHeader"
                className="text-sm font-medium text-text-muted cursor-pointer select-none"
              >
                First row is a header (Skip it)
              </label>
            </Card>

            {mode === 'import' && (
              <Card
                variant="subtle"
                className="flex items-center gap-3 p-4 border-info/20 bg-info-soft/50"
              >
                <input
                  type="checkbox"
                  id="overwrite"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="w-4 h-4 accent-info"
                />
                <label
                  htmlFor="overwrite"
                  className="text-sm font-medium text-text-muted cursor-pointer select-none"
                >
                  Overwrite existing entries
                </label>
              </Card>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-text-faint uppercase tracking-wider">
              Preview & Filtering
            </h3>
            <p className="text-[11px] text-text-muted italic mb-2">
              Note: Empty source/target rows will be filtered out automatically.
            </p>
            <Card variant="surface" className="table-shell !rounded-xl !shadow-sm">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="table-head">
                  <tr>
                    {colIndexes.map((i) => (
                      <th
                        key={i}
                        className={`px-4 py-3 font-bold text-[11px] uppercase tracking-tight ${
                          i === sourceCol
                            ? 'text-brand bg-brand-soft/50'
                            : i === targetCol
                              ? 'text-success bg-success-soft/50'
                              : 'text-text-muted'
                        }`}
                      >
                        Col {XLSX_COL_NAME(i)}
                        {i === sourceCol && <span className="block text-[9px] mt-0.5">Source</span>}
                        {i === targetCol && <span className="block text-[9px] mt-0.5">Target</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {previewData.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={`${hasHeader && rowIndex === 0 ? 'bg-muted/80 opacity-60 italic' : 'bg-surface'}`}
                    >
                      {colIndexes.map((i) => (
                        <td
                          key={i}
                          className={`px-4 py-3 truncate max-w-[200px] text-xs ${
                            i === sourceCol
                              ? 'bg-brand-soft/20 font-medium'
                              : i === targetCol
                                ? 'bg-success-soft/20'
                                : ''
                          }`}
                        >
                          {row[i] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>

        <div className="panel-footer px-8 py-6 flex justify-end items-center gap-3">
          {sameColumnSelected && (
            <p className="text-xs text-danger mr-auto">
              Source and target must be different columns.
            </p>
          )}
          <Button onClick={onClose} variant="secondary" size="lg">
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm({ hasHeader, sourceCol, targetCol, overwrite });
            }}
            disabled={sameColumnSelected}
            variant="primary"
            size="lg"
            className="!px-8 shadow-md shadow-brand/20 transition-all hover:-translate-y-0.5"
          >
            {copy.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function XLSX_COL_NAME(n: number): string {
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
