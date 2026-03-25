import React from 'react';
import type { Segment } from '@cat/core/models';

interface ProgressBarProps {
  segments: Segment[];
  compact?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ segments, compact }) => {
  const total = segments.length;
  const completed = segments.filter((s) => s.status === 'confirmed').length;
  const draft = segments.filter((s) => s.status === 'draft').length;

  const completedPct = total === 0 ? 0 : (completed / total) * 100;
  const draftPct = total === 0 ? 0 : (draft / total) * 100;

  if (compact) {
    return (
      <div className="flex flex-col gap-1 w-full">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden flex w-full">
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${completedPct}%` }}
          />
          <div
            className="h-full bg-warning transition-all duration-500"
            style={{ width: `${draftPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[8px] font-bold text-text-faint uppercase tracking-tight">
          <span>{Math.round(completedPct)}% Confirmed</span>
          <span>{total} Segments</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 bg-muted rounded-lg border border-border/60 flex flex-col gap-2">
      <div className="flex justify-between items-center text-xs font-medium text-text-muted">
        <div className="flex gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success" />
            Confirmed: {completed}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-warning" />
            Draft: {draft}
          </span>
        </div>
        <span>Total: {total}</span>
      </div>

      <div className="h-2 bg-border rounded-full overflow-hidden flex">
        <div
          className="h-full bg-success transition-all duration-500"
          style={{ width: `${completedPct}%` }}
        />
        <div
          className="h-full bg-warning transition-all duration-500"
          style={{ width: `${draftPct}%` }}
        />
      </div>
    </div>
  );
};
