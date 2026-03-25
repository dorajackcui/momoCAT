import React from 'react';
import type { Token } from '@cat/core/models';

/**
 * Props interface for the TagContextMenu component
 *
 * This component displays a context menu when users right-click on tags,
 * providing quick access to tag-specific operations.
 */
export interface TagContextMenuProps {
  /** The tag token that was right-clicked */
  tag: Token;

  /** Zero-based index of the tag in the token sequence */
  tagIndex: number;

  /** Position where the context menu should appear */
  position: { x: number; y: number };

  /** Index of the paired tag (if this is a paired tag) */
  pairedTagIndex?: number;

  /** Callback to close the context menu */
  onClose: () => void;

  /** Callback when "View Full Content" is selected */
  onViewContent: () => void;

  /** Callback when "Copy Tag" is selected */
  onCopyTag: () => void;

  /** Callback when "Delete Tag" is selected */
  onDeleteTag: () => void;

  /** Callback when "Jump to Pair" is selected (only for paired tags) */
  onJumpToPair?: () => void;
}

/**
 * TagContextMenu Component
 *
 * Displays a context menu with tag-specific actions when users right-click on tags.
 *
 * Features:
 * - Positioned at the click location
 * - Provides "View Full Content" to see complete tag markup
 * - Provides "Copy Tag" to copy tag content to clipboard
 * - Provides "Delete Tag" to remove the tag
 * - Conditionally provides "Jump to Pair" for paired tags only
 * - Closes automatically after action selection
 *
 * **Validates: Requirements 10.1, 10.2, 10.7**
 *
 * @example
 * ```tsx
 * <TagContextMenu
 *   tag={selectedTag}
 *   tagIndex={2}
 *   position={{ x: 150, y: 200 }}
 *   pairedTagIndex={5}
 *   onClose={() => setMenuVisible(false)}
 *   onViewContent={() => showTagDetails()}
 *   onCopyTag={() => copyToClipboard()}
 *   onDeleteTag={() => removeTag()}
 *   onJumpToPair={() => focusOnPairedTag()}
 * />
 * ```
 */
export const TagContextMenu: React.FC<TagContextMenuProps> = ({
  position,
  pairedTagIndex,
  onClose,
  onViewContent,
  onCopyTag,
  onDeleteTag,
  onJumpToPair,
}) => {
  // Handle menu item click - execute action and close menu
  const handleMenuItemClick = (action: () => void) => {
    action();
    onClose();
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => {
      onClose();
    };

    // Add listener after a small delay to avoid immediate closure
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [onClose]);

  // Close menu on Escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed bg-surface border border-border rounded-md shadow-lg z-50 py-1 min-w-[180px]"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="Tag context menu"
      onClick={(e) => e.stopPropagation()}
    >
      {/* View Full Content */}
      <button
        onClick={() => handleMenuItemClick(onViewContent)}
        className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
        role="menuitem"
        aria-label="View full tag content"
      >
        <span className="text-text-muted">View Full Content</span>
      </button>

      {/* Copy Tag */}
      <button
        onClick={() => handleMenuItemClick(onCopyTag)}
        className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
        role="menuitem"
        aria-label="Copy tag to clipboard"
      >
        <span className="text-text-muted">Copy Tag</span>
      </button>

      {/* Delete Tag */}
      <button
        onClick={() => handleMenuItemClick(onDeleteTag)}
        className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2 text-danger"
        role="menuitem"
        aria-label="Delete tag"
      >
        <span>Delete Tag</span>
      </button>

      {/* Jump to Pair - Only shown for paired tags */}
      {pairedTagIndex !== undefined && onJumpToPair && (
        <>
          <div className="border-t border-border/60 my-1" role="separator" />
          <button
            onClick={() => handleMenuItemClick(onJumpToPair)}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
            role="menuitem"
            aria-label="Jump to paired tag"
          >
            <span className="text-text-muted">Jump to Pair</span>
          </button>
        </>
      )}
    </div>
  );
};
