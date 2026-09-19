import React, { useCallback, useEffect, useMemo } from 'react';
import type { Segment, Token } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { TagInsertionUI } from './TagInsertionUI';
import { EditorMatchMode, type RepeatedSourceRole } from './editorFilterUtils';
import { EditorRowSourceCell } from './editor-row/EditorRowSourceCell';
import { EditorRowNumberCell } from './editor-row/EditorRowNumberCell';
import { EditorRowTargetActions } from './editor-row/EditorRowTargetActions';
import { EditorRowFeedback } from './editor-row/EditorRowFeedback';
import { EditorRowTargetCell, resolvePreviewSelection } from './editor-row/EditorRowTargetCell';
import { EDITOR_ROW_MIN_HEIGHT } from './editor/editorVirtualizationFlag';
import {
  useEditorRowDraftController,
  type TargetEditorController,
} from './editor-row/useEditorRowDraftController';
import { useEditorRowCommandHandlers } from './editor-row/useEditorRowCommandHandlers';
import { useEditorRowDisplayModel } from './editor-row/useEditorRowDisplayModel';

interface EditorRowProps {
  segment: Segment;
  rowNumber: number;
  isActive: boolean;
  repeatedSourceRole?: RepeatedSourceRole;
  disableAutoFocus?: boolean;
  saveError?: string;
  sourceHighlightQuery?: string;
  targetHighlightQuery?: string;
  contextHighlightQuery?: string;
  highlightMode?: EditorMatchMode;
  showNonPrintingSymbols?: boolean;
  onActivate: (id: string, options?: { autoFocusTarget?: boolean }) => void;
  onAutoFocus?: (id: string) => void;
  onChange: (id: string, value: string) => void;
  onBlur?: (id: string) => Promise<void>;
  onEditStateChange?: (id: string, editing: boolean) => void;
  onTargetEditorControllerChange: (id: string, controller: TargetEditorController | null) => void;
  onAITranslate: (id: string) => void;
  onAIRefine: (id: string, instruction: string) => void;
  onConfirm: (id: string) => void;
  isAITranslating?: boolean;
  isAIRefining?: boolean;
}

export {
  hasRefinableTargetText,
  normalizeRefinementInstruction,
  parseVisualizedNonPrintingSymbols,
  shouldSyncDraftFromExternalTarget,
  visualizeNonPrintingSymbols,
} from './editor-row/editorRowUtils';

const EditorRowComponent: React.FC<EditorRowProps> = ({
  segment,
  rowNumber,
  isActive,
  repeatedSourceRole,
  disableAutoFocus = false,
  saveError,
  sourceHighlightQuery = '',
  targetHighlightQuery = '',
  contextHighlightQuery = '',
  highlightMode = 'contains',
  showNonPrintingSymbols = false,
  onActivate,
  onAutoFocus,
  onChange,
  onBlur,
  onEditStateChange,
  onTargetEditorControllerChange,
  onAITranslate,
  onAIRefine,
  onConfirm,
  isAITranslating = false,
  isAIRefining = false,
}) => {
  const qaIssues = segment.qaIssues || [];

  const sourceTags = useMemo(() => {
    const seen = new Set<string>();
    return segment.sourceTokens.filter((token): token is Token => {
      if (token.type !== 'tag') return false;
      if (seen.has(token.content)) return false;
      seen.add(token.content);
      return true;
    });
  }, [segment.sourceTokens]);

  const sourceEditorText = useMemo(
    () =>
      serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n'),
    [segment.sourceTokens],
  );

  const targetEditorText = useMemo(
    () =>
      serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n'),
    [segment.targetTokens, segment.sourceTokens],
  );

  const tagMenuAnchorRef = React.useRef<HTMLButtonElement>(null);
  const {
    editorHostRef,
    draftText,
    setShortcutActionHandler,
    capturePendingCaretCoords,
    capturePendingSelection,
    editorController,
  } = useEditorRowDraftController({
    segmentId: segment.segmentId,
    targetEditorText,
    targetHighlightQuery,
    highlightMode,
    isActive,
    disableAutoFocus,
    showNonPrintingSymbols,
    onAutoFocus,
    onChange,
    onBlur,
    onEditStateChange,
  });

  const {
    showTagInsertionUI,
    toggleTagInsertionUI,
    closeTagInsertionUI,
    handleInsertTag,
    handleInsertAllTags,
    handleCopySourceToTarget,
    handleSourceCellClick,
    handleShortcutAction,
  } = useEditorRowCommandHandlers({
    segmentId: segment.segmentId,
    isActive,
    sourceTags,
    sourceEditorText,
    onActivate,
    onConfirm,
    editorController,
  });

  const displayModel = useEditorRowDisplayModel({
    segmentStatus: segment.status,
    qaIssues,
    isActive,
    draftText,
    sourceEditorText,
    sourceTagsCount: sourceTags.length,
    sourceHighlightQuery,
    highlightMode,
    showNonPrintingSymbols,
  });

  const renderChunks = useCallback(
    (chunks: { text: string; isMatch: boolean }[]) =>
      chunks.map((chunk, index) =>
        chunk.isMatch ? (
          <mark key={index} className="editor-search-highlight">
            {chunk.text}
          </mark>
        ) : (
          <span key={index}>{chunk.text}</span>
        ),
      ),
    [],
  );

  useEffect(() => {
    setShortcutActionHandler(handleShortcutAction);
  }, [handleShortcutAction, setShortcutActionHandler]);

  useEffect(() => {
    if (!isActive) return;

    onTargetEditorControllerChange(segment.segmentId, editorController);
    return () => {
      onTargetEditorControllerChange(segment.segmentId, null);
    };
  }, [editorController, isActive, onTargetEditorControllerChange, segment.segmentId]);

  return (
    <div
      className={`group grid grid-cols-[30px_minmax(0,1fr)_8px_minmax(0,1fr)] border-b border-border-subtle transition-colors ${
        isActive ? 'bg-brand-soft/20' : 'hover:bg-muted/30'
      }`}
      style={{ minHeight: EDITOR_ROW_MIN_HEIGHT }}
      onClick={(event) => {
        const preview = event.currentTarget.querySelector<HTMLElement>('.editor-target-preview');
        capturePendingSelection(
          preview
            ? resolvePreviewSelection(
                preview,
                preview.ownerDocument.defaultView?.getSelection() ?? null,
                targetEditorText,
                showNonPrintingSymbols,
              )
            : null,
        );
        // Remember where the user clicked so activation can place the caret
        // there instead of resetting it to the start of the segment.
        capturePendingCaretCoords({ x: event.clientX, y: event.clientY });
        onActivate(segment.segmentId);
      }}
    >
      <EditorRowNumberCell rowNumber={rowNumber} repeatedSourceRole={repeatedSourceRole} />

      <EditorRowSourceCell
        sourceContent={renderChunks(displayModel.sourceHighlightChunks)}
        onSourceCellClick={handleSourceCellClick}
        onCopySourceToTarget={handleCopySourceToTarget}
      />

      <div className="relative overflow-visible" title={displayModel.statusTitle}>
        <div className={`absolute inset-0 w-full ${displayModel.statusLine}`} />
      </div>

      <div
        data-active={isActive || undefined}
        className={`editor-target-cell editor-cell-bg px-1.5 py-0.5 relative flex min-h-full min-w-0 flex-col ${
          showTagInsertionUI ? 'overflow-visible' : 'overflow-hidden'
        }`}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-20 border-t-2 border-r-2 border-b-2 border-focus/80 transition-opacity duration-150 ${
            isActive ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <EditorRowTargetCell
          editorHostRef={editorHostRef as React.Ref<HTMLDivElement>}
          isActive={isActive}
          previewText={targetEditorText}
          highlightQuery={targetHighlightQuery}
          highlightMode={highlightMode}
          showNonPrintingSymbols={showNonPrintingSymbols}
        />

        {displayModel.showTargetActionButtons && (
          <EditorRowTargetActions
            tagMenuAnchorRef={tagMenuAnchorRef}
            isTagMenuOpen={showTagInsertionUI}
            hasRefinableTarget={displayModel.hasRefinableTarget}
            isAIBusy={isAIRefining || isAITranslating}
            canAITranslate={displayModel.canAITranslate}
            canInsertTags={displayModel.canInsertTags}
            onAIRefine={(instruction) => onAIRefine(segment.segmentId, instruction)}
            onAITranslate={() => onAITranslate(segment.segmentId)}
            onFocusTarget={editorController.focus}
            onToggleTagInsertionUI={toggleTagInsertionUI}
          />
        )}

        <TagInsertionUI
          anchor={tagMenuAnchorRef}
          onClose={closeTagInsertionUI}
          sourceTags={sourceTags}
          onInsertTag={handleInsertTag}
          onInsertAllTags={handleInsertAllTags}
          isVisible={isActive && showTagInsertionUI}
        />

        <EditorRowFeedback
          qaIssues={qaIssues}
          saveError={saveError}
          contextText={segment.meta?.context}
          contextHighlightQuery={contextHighlightQuery}
          highlightMode={highlightMode}
        />
      </div>
    </div>
  );
};

const areEditorRowPropsEqual = (prev: EditorRowProps, next: EditorRowProps): boolean =>
  prev.segment === next.segment &&
  prev.rowNumber === next.rowNumber &&
  prev.isActive === next.isActive &&
  prev.repeatedSourceRole === next.repeatedSourceRole &&
  prev.disableAutoFocus === next.disableAutoFocus &&
  prev.saveError === next.saveError &&
  prev.sourceHighlightQuery === next.sourceHighlightQuery &&
  prev.targetHighlightQuery === next.targetHighlightQuery &&
  prev.contextHighlightQuery === next.contextHighlightQuery &&
  prev.highlightMode === next.highlightMode &&
  prev.showNonPrintingSymbols === next.showNonPrintingSymbols &&
  prev.isAITranslating === next.isAITranslating &&
  prev.isAIRefining === next.isAIRefining &&
  prev.onActivate === next.onActivate &&
  prev.onAutoFocus === next.onAutoFocus &&
  prev.onChange === next.onChange &&
  prev.onBlur === next.onBlur &&
  prev.onEditStateChange === next.onEditStateChange &&
  prev.onTargetEditorControllerChange === next.onTargetEditorControllerChange &&
  prev.onAITranslate === next.onAITranslate &&
  prev.onAIRefine === next.onAIRefine &&
  prev.onConfirm === next.onConfirm;

export const EditorRow = React.memo(EditorRowComponent, areEditorRowPropsEqual);
