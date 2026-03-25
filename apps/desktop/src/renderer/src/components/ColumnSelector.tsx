import React, { useEffect, useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import type { ImportOptions, SpreadsheetPreviewData } from '../../../shared/ipc';
import { Button, Card, IconButton, Select } from './ui';

interface ColumnSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: ImportOptions) => void;
  previewData: SpreadsheetPreviewData;
  projectType?: ProjectType;
}

export function ColumnSelector({
  isOpen,
  onClose,
  onConfirm,
  previewData,
  projectType = 'translation',
}: ColumnSelectorProps) {
  const [hasHeader, setHasHeader] = useState(true);
  const [sourceCol, setSourceCol] = useState(0);
  const [targetCol, setTargetCol] = useState(1);
  const [contextCol, setContextCol] = useState<number | undefined>(undefined);

  const isReviewProject = projectType === 'review';
  const isCustomProject = projectType === 'custom';
  const sourceLabel = isReviewProject
    ? 'Translation Column'
    : isCustomProject
      ? 'Input Column'
      : 'Source Column';
  const targetLabel = isReviewProject
    ? 'Review Output Column'
    : isCustomProject
      ? 'Output Column'
      : 'Target Column';
  const contextLabel = isReviewProject
    ? 'Original Column'
    : isCustomProject
      ? 'Context Column'
      : 'Comment/Context Column';
  const sourceTagLabel = isReviewProject ? 'Translation' : isCustomProject ? 'Input' : 'Source';
  const targetTagLabel = isReviewProject ? 'Review Output' : isCustomProject ? 'Output' : 'Target';
  const contextTagLabel = isReviewProject ? 'Original' : 'Context';

  const maxCols = previewData.length > 0 ? previewData[0].length : 0;
  const colIndexes = Array.from({ length: maxCols }, (_, i) => i);

  useEffect(() => {
    if (!isOpen || !isReviewProject) return;
    if (contextCol === undefined && colIndexes.length > 0) {
      // Keep review mode defaults aligned with opened preview columns.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContextCol(0);
    }
  }, [colIndexes.length, contextCol, isOpen, isReviewProject]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop !z-[100]">
      <div className="modal-card max-w-4xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="panel-header px-8 py-6 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-text">Import Configuration</h2>
            <p className="text-sm text-text-muted mt-1">
              {isReviewProject
                ? 'Select translation/original/output columns for AI review'
                : isCustomProject
                  ? 'Select input/context/output columns for AI custom processing'
                  : 'Select the columns to import from your spreadsheet'}
            </p>
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
          <div className="grid grid-cols-3 gap-8 mb-8">
            <div className="space-y-2">
              <label className="text-sm font-bold text-text-muted flex items-center gap-2">
                <span className="w-2 h-2 bg-brand rounded-full"></span>
                {sourceLabel}
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
                {targetLabel}
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

            <div className="space-y-2">
              <label className="text-sm font-bold text-text-muted flex items-center gap-2">
                <span className="w-2 h-2 bg-info rounded-full"></span>
                {contextLabel}
              </label>
              <Select
                value={
                  contextCol === undefined
                    ? isReviewProject
                      ? (colIndexes[0] ?? 0)
                      : -1
                    : contextCol
                }
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isReviewProject && val === -1) {
                    setContextCol(undefined);
                    return;
                  }
                  setContextCol(val);
                }}
                className="!p-2.5"
              >
                {!isReviewProject && <option value={-1}>None (Ignore)</option>}
                {colIndexes.map((i) => (
                  <option key={i} value={i}>
                    Column {XLSX_COL_NAME(i)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Card
            variant="subtle"
            className="mb-6 p-4 flex items-center gap-3 border-brand/20 bg-brand-soft/50"
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

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-text-faint uppercase tracking-wider">
              Preview (First 10 rows)
            </h3>
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
                              : i === contextCol
                                ? 'text-info bg-info-soft/50'
                                : 'text-text-muted'
                        }`}
                      >
                        Col {XLSX_COL_NAME(i)}
                        {i === sourceCol && (
                          <span className="block text-[9px] mt-0.5">{sourceTagLabel}</span>
                        )}
                        {i === targetCol && (
                          <span className="block text-[9px] mt-0.5">{targetTagLabel}</span>
                        )}
                        {i === contextCol && (
                          <span className="block text-[9px] mt-0.5">{contextTagLabel}</span>
                        )}
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
                                : i === contextCol
                                  ? 'bg-info-soft/20'
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

        <div className="panel-footer px-8 py-6 flex justify-end gap-3">
          <Button onClick={onClose} variant="secondary" size="lg">
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                hasHeader,
                sourceCol,
                targetCol,
                contextCol: isReviewProject ? (contextCol ?? 0) : contextCol,
              })
            }
            variant="primary"
            size="lg"
            className="!px-8 shadow-md shadow-brand/20 hover:-translate-y-0.5 transition-all"
          >
            Start Import
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
