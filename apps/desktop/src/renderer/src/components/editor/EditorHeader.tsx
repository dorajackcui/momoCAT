import { IconButton, Button } from '../ui';
import React from 'react';

interface EditorHeaderProps {
  fileName: string | null;
  projectName: string | null;
  srcLang: string | null;
  tgtLang: string | null;
  saveErrorCount: number;
  confirmedSegments: number;
  totalSegments: number;
  onBack: () => void;
  onExport: () => void;
}

const EditorHeaderComponent: React.FC<EditorHeaderProps> = ({
  fileName,
  projectName,
  srcLang,
  tgtLang,
  saveErrorCount,
  confirmedSegments,
  totalSegments,
  onBack,
  onExport,
}) => {
  const progress =
    totalSegments > 0 ? Math.min(100, Math.max(0, (confirmedSegments / totalSegments) * 100)) : 0;
  return (
    <header className="px-6 py-3 border-b border-border-subtle flex justify-between items-center bg-surface-chrome z-10">
      <div className="flex items-center gap-4">
        <IconButton
          size="sm"
          tone="neutral"
          variant="ghost"
          onClick={onBack}
          title="Back to Project"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </IconButton>
        <div>
          <h2 className="text-sm font-bold text-text leading-tight">{fileName || 'Loading...'}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-caption text-brand font-bold uppercase tracking-wider">
              {projectName}
            </span>
            <span className="text-caption text-text-faint">•</span>
            <span className="text-caption text-text-muted font-medium uppercase tracking-wider">
              {srcLang} → {tgtLang}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {saveErrorCount > 0 && (
          <div className="px-2.5 py-1 bg-danger-soft border border-danger/40 rounded-md text-2xs font-bold text-danger">
            {saveErrorCount} 段保存失败
          </div>
        )}
        <div
          role="progressbar"
          aria-label="Confirmed segments"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${confirmedSegments} of ${totalSegments} confirmed`}
          className="flex items-center gap-2.5"
        >
          <span className="h-[3px] w-11 overflow-hidden rounded-full bg-border-subtle">
            <span
              className="block h-full rounded-full bg-status-confirmed"
              style={{ width: `${progress}%` }}
            />
          </span>
          <span className="text-2xs tabular-nums text-text-muted">
            {confirmedSegments}/{totalSegments}
          </span>
        </div>
        <div className="h-4 w-[1px] bg-border-subtle" />
        <Button size="xs" variant="primary" onClick={onExport}>
          Export
        </Button>
      </div>
    </header>
  );
};

export const EditorHeader = React.memo(EditorHeaderComponent);
