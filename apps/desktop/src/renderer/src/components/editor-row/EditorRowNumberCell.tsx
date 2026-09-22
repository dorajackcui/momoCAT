import React from 'react';
import type { RepeatedSourceRole } from '../editorFilterUtils';
import type { SegmentSelectionModifiers } from '../../hooks/editor/useEditorSelection';

interface EditorRowNumberCellProps {
  rowNumber: number;
  repeatedSourceRole?: RepeatedSourceRole;
  isSelected?: boolean;
  onSelect?: (modifiers: SegmentSelectionModifiers) => void;
}

export const EditorRowNumberCell: React.FC<EditorRowNumberCellProps> = ({
  rowNumber,
  repeatedSourceRole,
  isSelected,
  onSelect,
}) => (
  <div
    className="editor-row-number px-0 py-0.5 border-r border-border-subtle editor-cell-bg flex min-h-full flex-col items-center focus:outline-none"
    role="button"
    tabIndex={0}
    aria-label={`Select segment ${rowNumber}`}
    aria-pressed={isSelected}
    onMouseDown={(event) => {
      if (event.shiftKey) event.preventDefault();
    }}
    onClick={(event) => {
      if (!onSelect) return;
      event.stopPropagation();
      event.currentTarget.focus();
      onSelect(event);
    }}
    onKeyDown={(event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (onSelect) {
          event.stopPropagation();
          onSelect(event);
        } else {
          event.currentTarget.click();
        }
      }
    }}
  >
    <div className="mt-0.5 text-reference-meta leading-gutter font-medium text-text-faint select-none">
      {rowNumber}
    </div>
    {repeatedSourceRole && (
      <span
        className="relative mt-0.5 inline-flex h-[11px] w-[11px] items-center justify-center text-2xs leading-none text-text-faint transition-colors select-none group-hover:text-brand"
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
            className="pointer-events-none absolute -right-[3px] -top-[2px] text-gutter-marker font-semibold leading-none"
          >
            1
          </span>
        )}
      </span>
    )}
  </div>
);
