import React, { useCallback, useEffect, useMemo } from 'react';
import type { Segment, Token } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { TagInsertionUI } from './TagInsertionUI';
import { EditorMatchMode } from './editorFilterUtils';
import { EditorRowSourceCell } from './editor-row/EditorRowSourceCell';
import { EditorRowTargetActions } from './editor-row/EditorRowTargetActions';
import { EditorRowFeedback } from './editor-row/EditorRowFeedback';
import { EditorRowTargetCell } from './editor-row/EditorRowTargetCell';
import { useEditorRowDraftController } from './editor-row/useEditorRowDraftController';
import { useEditorRowCommandHandlers } from './editor-row/useEditorRowCommandHandlers';
import { useEditorRowDisplayModel } from './editor-row/useEditorRowDisplayModel';

interface EditorRowProps {
  segment: Segment;
  rowNumber: number;
  isActive: boolean;
  disableAutoFocus?: boolean;
  saveError?: string;
  sourceHighlightQuery?: string;
  targetHighlightQuery?: string;
  highlightMode?: EditorMatchMode;
  showNonPrintingSymbols?: boolean;
  onActivate: (id: string, options?: { autoFocusTarget?: boolean }) => void;
  onAutoFocus?: (id: string) => void;
  onChange: (id: string, value: string) => void;
  onBlur?: (id: string) => Promise<void>;
  onEditStateChange?: (id: string, editing: boolean) => void;
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
  shouldShowAIRefineControl,
  visualizeNonPrintingSymbols,
} from './editor-row/editorRowUtils';

const EditorRowComponent: React.FC<EditorRowProps> = ({
  segment,
  rowNumber,
  isActive,
  disableAutoFocus = false,
  saveError,
  sourceHighlightQuery = '',
  targetHighlightQuery = '',
  highlightMode = 'contains',
  showNonPrintingSymbols = false,
  onActivate,
  onAutoFocus,
  onChange,
  onBlur,
  onEditStateChange,
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

  const {
    editorHostRef,
    draftText,
    setShortcutActionHandler,
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
    aiRefineInputRef,
    showTagInsertionUI,
    showAIRefineInput,
    aiRefineDraft,
    setAiRefineDraft,
    toggleTagInsertionUI,
    toggleAIRefineInput,
    handleInsertTag,
    handleInsertAllTags,
    handleCopySourceToTarget,
    handleSourceCellClick,
    handleAIRefineInputKeyDown,
    handleShortcutAction,
  } = useEditorRowCommandHandlers({
    segmentId: segment.segmentId,
    isActive,
    isAIRefining,
    sourceTags,
    sourceEditorText,
    onActivate,
    onAIRefine,
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
          <mark
            key={index}
            className="bg-warning/40 text-text rounded-[2px] shadow-[inset_0_0_0_1px_rgba(169,119,37,0.55)]"
          >
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

  return (
    <div
      className={`group grid grid-cols-[30px_1fr_4px_1fr] border-b border-border transition-colors ${
        isActive ? 'bg-brand-soft/20' : 'hover:bg-muted/30'
      }`}
      onClick={() => onActivate(segment.segmentId)}
    >
      <div className="px-0 py-0.5 border-r border-border bg-muted/50 flex items-start justify-center">
        <div className="mt-0.5 text-[9px] font-medium text-text-faint select-none">{rowNumber}</div>
      </div>

      <EditorRowSourceCell
        sourceContent={renderChunks(displayModel.sourceHighlightChunks)}
        onSourceCellClick={handleSourceCellClick}
        onCopySourceToTarget={handleCopySourceToTarget}
      />

      <div className="relative overflow-visible" title={displayModel.statusTitle}>
        <div className={`absolute inset-0 w-full ${displayModel.statusLine}`} />
      </div>

      <div
        className={`px-1.5 py-0.5 relative ${
          qaIssues.some((issue) => issue.severity === 'error')
            ? 'bg-danger-soft/40'
            : qaIssues.some((issue) => issue.severity === 'warning')
              ? 'bg-warning-soft/35'
              : 'editor-cell-bg'
        }`}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -top-px -bottom-px left-0 right-0 z-20 border-t-[3px] border-r-[3px] border-b-[3px] border-brand/70 transition-opacity duration-150 ${
            isActive ? 'opacity-100 shadow-sm' : 'opacity-0'
          }`}
        />

        <EditorRowTargetCell
          editorHostRef={editorHostRef as React.Ref<HTMLDivElement>}
          isActive={isActive}
        />

        <EditorRowTargetActions
          aiRefineInputRef={aiRefineInputRef as React.Ref<HTMLInputElement>}
          showAIRefineInput={showAIRefineInput}
          showAIRefineControl={displayModel.showAIRefineControl}
          showTargetActionButtons={displayModel.showTargetActionButtons}
          aiRefineDraft={aiRefineDraft}
          isAIRefining={isAIRefining}
          isAITranslating={isAITranslating}
          canAITranslate={displayModel.canAITranslate}
          canInsertTags={displayModel.canInsertTags}
          onAiRefineDraftChange={setAiRefineDraft}
          onAIRefineInputKeyDown={handleAIRefineInputKeyDown}
          onToggleAIRefineInput={toggleAIRefineInput}
          onAITranslate={() => onAITranslate(segment.segmentId)}
          onToggleTagInsertionUI={toggleTagInsertionUI}
        />

        <TagInsertionUI
          sourceTags={sourceTags}
          onInsertTag={handleInsertTag}
          onInsertAllTags={handleInsertAllTags}
          isVisible={isActive && showTagInsertionUI}
        />

        <EditorRowFeedback
          qaIssues={qaIssues}
          saveError={saveError}
          contextText={segment.meta?.context}
        />
      </div>
    </div>
  );
};

const areEditorRowPropsEqual = (prev: EditorRowProps, next: EditorRowProps): boolean =>
  prev.segment === next.segment &&
  prev.rowNumber === next.rowNumber &&
  prev.isActive === next.isActive &&
  prev.disableAutoFocus === next.disableAutoFocus &&
  prev.saveError === next.saveError &&
  prev.sourceHighlightQuery === next.sourceHighlightQuery &&
  prev.targetHighlightQuery === next.targetHighlightQuery &&
  prev.highlightMode === next.highlightMode &&
  prev.showNonPrintingSymbols === next.showNonPrintingSymbols &&
  prev.isAITranslating === next.isAITranslating &&
  prev.isAIRefining === next.isAIRefining &&
  prev.onActivate === next.onActivate &&
  prev.onAutoFocus === next.onAutoFocus &&
  prev.onChange === next.onChange &&
  prev.onBlur === next.onBlur &&
  prev.onEditStateChange === next.onEditStateChange &&
  prev.onAITranslate === next.onAITranslate &&
  prev.onAIRefine === next.onAIRefine &&
  prev.onConfirm === next.onConfirm;

export const EditorRow = React.memo(EditorRowComponent, areEditorRowPropsEqual);
