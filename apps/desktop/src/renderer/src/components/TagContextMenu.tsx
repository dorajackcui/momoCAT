import type { Token } from '@cat/core/models';
import { Menu, MenuItem, MenuSeparator } from './ui';
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

export function TagContextMenu({
  position,
  pairedTagIndex,
  onClose,
  onViewContent,
  onCopyTag,
  onDeleteTag,
  onJumpToPair,
}: TagContextMenuProps) {
  return (
    <Menu anchor={position} placement="bottom-start" onClose={onClose} label="Tag context menu">
      <MenuItem onClick={onViewContent} aria-label="View full tag content">
        View Full Content
      </MenuItem>
      <MenuItem onClick={onCopyTag} aria-label="Copy tag to clipboard">
        Copy Tag
      </MenuItem>
      <MenuItem onClick={onDeleteTag} danger aria-label="Delete tag">
        Delete Tag
      </MenuItem>
      {pairedTagIndex !== undefined && onJumpToPair && (
        <>
          <MenuSeparator />
          <MenuItem onClick={onJumpToPair} aria-label="Jump to paired tag">
            Jump to Pair
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
