import React, { useEffect, useRef, useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
import type { ImportOptions, SpreadsheetPreviewData } from '../../../shared/ipc';
import { resolveDefaultContextColumn } from '../../../shared/importColumnDefaults';
import { Button, Card, Modal, Select, Checkbox } from './ui';

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
  const [tagPolicy, setTagPolicy] = useState<TagPolicy>('default');
  const wasOpenRef = useRef(isOpen);

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
    if (isOpen && !wasOpenRef.current) {
      setTagPolicy('default');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || contextCol !== undefined || colIndexes.length === 0) return;

    const defaultContextCol = resolveDefaultContextColumn({
      hasHeader,
      previewData,
      projectType,
      sourceCol,
    });
    if (defaultContextCol === undefined) return;

    // Keep default column selection aligned with opened preview columns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContextCol(defaultContextCol);
  }, [colIndexes.length, contextCol, hasHeader, isOpen, previewData, projectType, sourceCol]);

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      closeOnBackdrop={false}
      title="Import Configuration"
      description={
        isReviewProject
          ? 'Select translation/original/output columns for AI review'
          : isCustomProject
            ? 'Select input/context/output columns for AI custom processing'
            : 'Select the columns to import from your spreadsheet'
      }
      size="xl"
      footer={
        <>
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
                tagPolicy,
              })
            }
            variant="primary"
            size="lg"
            className="min-w-28"
          >
            Start Import
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-8 mb-8">
        <div className="space-y-2">
          <label className="text-sm font-bold text-text-muted flex items-center gap-2">
            <span className="w-2 h-2 bg-brand rounded-full"></span>
            {sourceLabel}
          </label>
          <Select
            size="compact"
            value={sourceCol}
            onChange={(e) => setSourceCol(parseInt(e.target.value, 10))}
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
            size="compact"
            value={targetCol}
            onChange={(e) => setTargetCol(parseInt(e.target.value, 10))}
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
            size="compact"
            value={
              contextCol === undefined ? (isReviewProject ? (colIndexes[0] ?? 0) : -1) : contextCol
            }
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isReviewProject && val === -1) {
                setContextCol(undefined);
                return;
              }
              setContextCol(val);
            }}
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
        className="mb-6 p-4 flex flex-wrap items-center justify-between gap-4 border-brand/20 bg-brand-soft/50"
      >
        <div className="flex items-center gap-3">
          <Checkbox
            id="hasHeader"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.target.checked)}
          />
          <label
            htmlFor="hasHeader"
            className="text-sm font-medium text-text-muted cursor-pointer select-none"
          >
            First row is a header (Skip it)
          </label>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium text-text-muted">
          <span>Marker Handling</span>
          <Select
            size="compact"
            value={tagPolicy}
            onChange={(e) => setTagPolicy(e.target.value as TagPolicy)}
            className="w-auto min-w-[180px]"
          >
            <option value="default">Protect CAT markers</option>
            <option value="none">Plain marker-like text</option>
          </Select>
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
    </Modal>
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
