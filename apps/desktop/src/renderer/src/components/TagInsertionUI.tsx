import React from 'react';
import type { Token } from '@cat/core/models';
import { formatTagAsMemoQMarker } from '@cat/core/tag';

/**
 * Props interface for the TagInsertionUI component
 *
 * This component provides a visual interface for inserting tags from the source
 * segment into the target segment. It displays a dropdown list of available tags
 * and an "Insert All Tags" button.
 */
export interface TagInsertionUIProps {
  /** Array of source tags available for insertion */
  sourceTags: Token[];

  /** Callback when a specific tag is selected for insertion */
  onInsertTag: (tagIndex: number) => void;

  /** Callback when "Insert All Tags" button is clicked */
  onInsertAllTags: () => void;

  /** Controls visibility of the insertion UI */
  isVisible: boolean;
}

/**
 * TagInsertionUI Component
 *
 * Provides a visual interface for inserting tags from source into target segments.
 *
 * Features:
 * - Displays a dropdown list of available source tags
 * - Shows tag preview with display format and full content
 * - Provides "Insert All Tags" button for bulk insertion
 * - Automatically hidden when no tags are available or isVisible is false
 *
 * **Validates: Requirements 11.1, 11.2, 11.3**
 *
 * @example
 * ```tsx
 * <TagInsertionUI
 *   sourceTags={sourceTokens.filter(t => t.type === 'tag')}
 *   onInsertTag={(index) => handleInsertTag(index)}
 *   onInsertAllTags={() => handleInsertAllTags()}
 *   isVisible={isSegmentActive}
 * />
 * ```
 */
export const TagInsertionUI: React.FC<TagInsertionUIProps> = ({
  sourceTags,
  onInsertTag,
  onInsertAllTags,
  isVisible,
}) => {
  // Don't render if not visible or no tags available
  if (!isVisible || sourceTags.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-md shadow-lg z-30 min-w-[200px]"
      role="menu"
      aria-label="Tag insertion menu"
    >
      {/* Insert All Tags Button */}
      <div className="p-2 border-b border-border/60">
        <button
          onClick={onInsertAllTags}
          className="w-full px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand-soft rounded transition-colors"
          role="menuitem"
          aria-label="Insert all tags from source"
        >
          Insert All Tags
        </button>
      </div>

      {/* Individual Tag List */}
      <div className="max-h-48 overflow-y-auto">
        {sourceTags.map((tag, index) => {
          const marker = formatTagAsMemoQMarker(tag.content, index + 1);

          return (
            <button
              key={index}
              onClick={() => onInsertTag(index)}
              className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 transition-colors"
              role="menuitem"
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
            </button>
          );
        })}
      </div>
    </div>
  );
};
