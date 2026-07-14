import React from 'react';

interface EditorRowNumberCellProps {
  rowNumber: number;
  isRepeatedSource?: boolean;
}

export const EditorRowNumberCell: React.FC<EditorRowNumberCellProps> = ({
  rowNumber,
  isRepeatedSource = false,
}) => (
  <div className="px-0 py-0.5 border-r border-border bg-muted/50 flex min-h-full flex-col items-center">
    <div className="mt-0.5 text-[9px] leading-[10px] font-medium text-text-faint select-none">
      {rowNumber}
    </div>
    {isRepeatedSource && (
      <span
        className="mt-0.5 text-[11px] leading-none text-text-faint transition-colors select-none group-hover:text-brand"
        title="Same source as an earlier segment"
        aria-label="Repeated source"
      >
        ↻
      </span>
    )}
  </div>
);
