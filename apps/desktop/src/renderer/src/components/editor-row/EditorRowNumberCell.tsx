import React from 'react';
import type { RepeatedSourceRole } from '../editorFilterUtils';

interface EditorRowNumberCellProps {
  rowNumber: number;
  repeatedSourceRole?: RepeatedSourceRole;
}

export const EditorRowNumberCell: React.FC<EditorRowNumberCellProps> = ({
  rowNumber,
  repeatedSourceRole,
}) => (
  <div className="px-0 py-0.5 border-r border-border bg-muted/50 flex min-h-full flex-col items-center">
    <div className="mt-0.5 text-[9px] leading-[10px] font-medium text-text-faint select-none">
      {rowNumber}
    </div>
    {repeatedSourceRole && (
      <span
        className="relative mt-0.5 inline-flex h-[11px] w-[11px] items-center justify-center text-[11px] leading-none text-text-faint transition-colors select-none group-hover:text-brand"
        title={
          repeatedSourceRole === 'first'
            ? 'First occurrence of repeated source'
            : 'Later occurrence of repeated source'
        }
        aria-label={
          repeatedSourceRole === 'first' ? 'First occurrence of repeated source' : 'Repeated source'
        }
      >
        <span aria-hidden="true">↻</span>
        {repeatedSourceRole === 'first' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-[3px] -top-[2px] text-[7px] font-semibold leading-none"
          >
            1
          </span>
        )}
      </span>
    )}
  </div>
);
