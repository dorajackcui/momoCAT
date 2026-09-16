import { IconButton } from '../ui';
import React, { useState } from 'react';

interface EditorRowSourceCellProps {
  sourceContent: React.ReactNode;
  onSourceCellClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onCopySourceToTarget: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const EditorRowSourceCell: React.FC<EditorRowSourceCellProps> = ({
  sourceContent,
  onSourceCellClick,
  onCopySourceToTarget,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="px-1.5 py-0.5 editor-cell-bg relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSourceCellClick}
    >
      <div className="editor-source-text">{sourceContent}</div>
      {isHovered && (
        <div className="absolute top-2 right-2">
          <IconButton
            size="xs"
            tone="brand"
            variant="overlay"
            onClick={onCopySourceToTarget}
            title="Copy Source to Target"
            aria-label="Copy source to target"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            </svg>
          </IconButton>
        </div>
      )}
    </div>
  );
};
