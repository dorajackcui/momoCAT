import React from 'react';
import type { Token } from '@cat/core/models';
import { getTagDisplayInfo } from '@cat/core/tag';

/**
 * Props interface for the TagCapsule component
 *
 * This component renders individual tags with appropriate visual styling
 * and interaction handlers for the CAT tool editor.
 */
export interface TagCapsuleProps {
  /** The token to render (must be of type 'tag') */
  token: Token;

  /** Zero-based index of the tag in the token sequence */
  index: number;

  /** Whether this tag is in the source segment (affects color scheme) */
  isSource: boolean;

  /** Whether this tag is currently selected */
  isSelected: boolean;

  /** Validation state of the tag (affects border styling) */
  validationState?: 'valid' | 'error' | 'warning';

  /** Callback when the tag is selected/clicked */
  onSelect: (index: number) => void;

  /** Callback when the tag is deleted */
  onDelete: (index: number) => void;

  /** Callback when the tag is right-clicked for context menu */
  onContextMenu: (index: number, event: React.MouseEvent) => void;

  /** Callback when drag operation starts */
  onDragStart: (index: number, event: React.DragEvent) => void;

  /** Callback when drag operation ends */
  onDragEnd: (index: number, event: React.DragEvent) => void;
}

/**
 * TagCapsule Component
 *
 * Renders individual tags with appropriate visual styling based on:
 * - Tag type (paired-start, paired-end, standalone)
 * - Source vs target segment
 * - Validation state (valid, error, warning)
 * - Selection state
 *
 * Supports interaction via:
 * - Click to select
 * - Right-click for context menu
 * - Drag and drop for reordering
 * - Keyboard navigation (via tabIndex)
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
export const TagCapsule: React.FC<TagCapsuleProps> = ({
  token,
  index,
  isSource,
  isSelected,
  validationState,
  onSelect,
  onDelete,
  onContextMenu,
  onDragStart,
  onDragEnd,
}) => {
  // Get display information for the tag
  const tagInfo = getTagDisplayInfo(token.content, index);

  // Base styles for all tags
  const baseStyles =
    'inline-flex items-center px-1 py-0.5 mx-0.5 text-[10px] font-bold border cursor-pointer select-none';

  // Color scheme based on source/target
  const colorStyles = isSource
    ? 'bg-brand-soft text-brand border-brand/30'
    : 'bg-brand text-white border-brand';

  // Validation state styling
  const validationStyles =
    validationState === 'error'
      ? 'ring-2 ring-danger'
      : validationState === 'warning'
        ? 'ring-2 ring-warning'
        : '';

  // Shape based on tag type
  const shapeStyles =
    tagInfo.type === 'paired-start'
      ? 'rounded-l'
      : tagInfo.type === 'paired-end'
        ? 'rounded-r'
        : 'rounded';

  // Selection styling
  const selectionStyles = isSelected ? 'ring-2 ring-brand/60' : '';

  // Handle click event
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(index);
  };

  // Handle context menu event
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(index, e);
  };

  // Handle drag start event
  const handleDragStart = (e: React.DragEvent) => {
    onDragStart(index, e);
  };

  // Handle drag end event
  const handleDragEnd = (e: React.DragEvent) => {
    onDragEnd(index, e);
  };

  // Handle keyboard events for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(index);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(index);
    }
  };

  return (
    <span
      className={`${baseStyles} ${colorStyles} ${validationStyles} ${shapeStyles} ${selectionStyles}`}
      contentEditable={false}
      data-tag={token.content}
      data-tag-index={index}
      data-tag-type={tagInfo.type}
      title={token.content}
      draggable
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Tag ${index + 1}: ${token.content}`}
    >
      {tagInfo.display}
    </span>
  );
};
