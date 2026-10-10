import type React from 'react';

interface EditorRowSourceCellProps {
  sourceContent: React.ReactNode;
  onSourceCellClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const EditorRowSourceCell: React.FC<EditorRowSourceCellProps> = ({
  sourceContent,
  onSourceCellClick,
}) => (
  <div className="px-1.5 py-0.5 editor-cell-bg" onClick={onSourceCellClick}>
    <div className="editor-source-text">{sourceContent}</div>
  </div>
);
