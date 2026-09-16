import React from 'react';
import type { Token } from '@cat/core/models';
import { Menu, MenuItem, type PopupAnchor } from './ui';
import { formatTagAsMemoQMarker } from '@cat/core/tag';

export interface TagInsertionUIProps {
  sourceTags: Token[];

  onInsertTag: (tagIndex: number) => void;

  onInsertAllTags: () => void;

  isVisible: boolean;
  anchor: PopupAnchor;
  onClose: () => void;
}

export const TagInsertionUI: React.FC<TagInsertionUIProps> = ({
  sourceTags,
  onInsertTag,
  onInsertAllTags,
  isVisible,
  anchor,
  onClose,
}) => {
  // Don't render if not visible or no tags available
  if (!isVisible || sourceTags.length === 0) {
    return null;
  }

  return (
    <Menu anchor={anchor} onClose={onClose} label="Tag insertion menu" className="w-64">
      {/* Insert All Tags Button */}
      <div className="p-2 border-b border-border/60">
        <MenuItem
          size="sm"
          tone="brand"
          onClick={onInsertAllTags}
          aria-label="Insert all tags from source"
        >
          Insert All Tags
        </MenuItem>
      </div>

      {/* Individual Tag List */}
      <div className="max-h-48 overflow-y-auto">
        {sourceTags.map((tag, index) => {
          const marker = formatTagAsMemoQMarker(tag.content, index + 1);

          return (
            <MenuItem
              key={index}
              onClick={() => onInsertTag(index)}
              aria-label={`Insert tag ${index + 1}: ${tag.content}`}
            >
              {/* Tag Preview Capsule */}
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded bg-brand-soft text-brand border border-brand/30 flex-shrink-0"
                aria-hidden="true"
              >
                {marker}
              </span>

              {/* Full Tag Content */}
              <span className="text-xs text-text-muted truncate">{tag.content}</span>
            </MenuItem>
          );
        })}
      </div>
    </Menu>
  );
};
