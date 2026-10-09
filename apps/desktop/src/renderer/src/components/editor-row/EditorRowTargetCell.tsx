import React from 'react';
import type { EditorEngineSelection } from '../editor-engine/types';
import { type EditorMatchMode } from '../editorFilterUtils';
import type { QaHighlight } from '@cat/core/models';
import { buildEditorHighlightChunks } from '../highlightRanges';
import { NonPrintingText } from '../NonPrintingText';

interface EditorRowTargetCellProps {
  editorHostRef: React.Ref<HTMLDivElement>;
  isActive: boolean;
  previewText: string;
  highlightQuery: string;
  qaHighlights?: QaHighlight[];
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

  return {
    anchor: getTextOffset(root, selection.anchorNode, selection.anchorOffset),
    head: getTextOffset(root, selection.focusNode, selection.focusOffset),
  };
}

export const EditorRowTargetCell: React.FC<EditorRowTargetCellProps> = ({
  editorHostRef,
  isActive,
  previewText,
  highlightQuery,
  qaHighlights = [],
  highlightMode,
  showNonPrintingSymbols,
}) => {
  const previewContent =
    highlightQuery.trim() || qaHighlights.length ? (
      buildEditorHighlightChunks(previewText, highlightQuery, highlightMode, qaHighlights).map(
        (chunk, index) => {
          const displayChunkText = (
            <NonPrintingText text={chunk.text} enabled={showNonPrintingSymbols} />
          );
          return chunk.isMatch ? (
            <mark key={index} className="cm-target-highlight">
              {displayChunkText}
            </mark>
          ) : (
            <span key={index}>{displayChunkText}</span>
          );
        },
      )
    ) : showNonPrintingSymbols ? (
      <NonPrintingText text={previewText} enabled />
    ) : (
      previewText
    );

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
