import React from 'react';
import type { EditorEngineSelection } from '../editor-engine/types';
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

type PreviewSelection = Pick<
  Selection,
  'anchorNode' | 'anchorOffset' | 'focusNode' | 'focusOffset' | 'isCollapsed'
>;

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function resolvePreviewSelection(
  root: HTMLElement,
  selection: PreviewSelection | null,
  previewText: string,
  showNonPrintingSymbols: boolean,
): EditorEngineSelection | null {
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }

  const toEditorOffset = (node: Node, offset: number) => {
    const previewOffset = getTextOffset(root, node, offset);
    if (!showNonPrintingSymbols) return previewOffset;

    let editorOffset = 0;
    let visualizedOffset = 0;
    while (editorOffset < previewText.length) {
      const visualizedWidth = previewText[editorOffset] === '\n' ? 2 : 1;
      if (visualizedOffset + visualizedWidth > previewOffset) break;
      visualizedOffset += visualizedWidth;
      editorOffset += 1;
    }
    return editorOffset;
  };

  return {
    anchor: toEditorOffset(selection.anchorNode, selection.anchorOffset),
    head: toEditorOffset(selection.focusNode, selection.focusOffset),
  };
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
