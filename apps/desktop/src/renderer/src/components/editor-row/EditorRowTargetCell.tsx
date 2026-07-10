import React from 'react';
import { buildHighlightChunks, type EditorMatchMode } from '../editorFilterUtils';
import { visualizeNonPrintingSymbols } from './editorRowUtils';

interface EditorRowTargetCellProps {
  editorHostRef: React.Ref<HTMLDivElement>;
  isActive: boolean;
  previewText: string;
  highlightQuery: string;
  highlightMode: EditorMatchMode;
  showNonPrintingSymbols: boolean;
}

export const EditorRowTargetCell: React.FC<EditorRowTargetCellProps> = ({
  editorHostRef,
  isActive,
  previewText,
  highlightQuery,
  highlightMode,
  showNonPrintingSymbols,
}) => {
  const previewContent = highlightQuery.trim()
    ? buildHighlightChunks(previewText, highlightQuery, highlightMode).map((chunk, index) => {
        const displayChunkText = showNonPrintingSymbols
          ? visualizeNonPrintingSymbols(chunk.text)
          : chunk.text;
        return chunk.isMatch ? (
          <mark key={index} className="cm-target-highlight">
            {displayChunkText}
          </mark>
        ) : (
          <span key={index}>{displayChunkText}</span>
        );
      })
    : showNonPrintingSymbols
      ? visualizeNonPrintingSymbols(previewText)
      : previewText;

  return (
    <div className="relative">
      {isActive ? (
        <div ref={editorHostRef} className="editor-target-text-layer editor-target-editor-host" />
      ) : (
        <div className="editor-target-text-layer editor-target-preview min-h-[36px] whitespace-pre-wrap break-words">
          {previewContent}
        </div>
      )}
    </div>
  );
};
