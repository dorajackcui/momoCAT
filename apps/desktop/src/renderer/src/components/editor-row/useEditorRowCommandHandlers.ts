import React, { useCallback, useEffect, useState } from 'react';
import type { Token } from '@cat/core/models';
import { formatTagAsMemoQMarker } from '@cat/core/tag';
import { resolveEditorShortcutAction } from '../editor-engine/shortcut';
import { EditorShortcutAction } from '../editor-engine/types';

interface UseEditorRowCommandHandlersParams {
  segmentId: string;
  isActive: boolean;
  sourceTags: Token[];
  sourceEditorText: string;
  onActivate: (id: string, options?: { autoFocusTarget?: boolean }) => void;
  onConfirm: (id: string) => void;
  editorController: {
    getSnapshot: () => {
      text: string;
      selectionFrom: number;
      selectionTo: number;
    } | null;
    setText: (nextText: string, preserveSelection?: boolean) => void;
    replaceSelection: (insertText: string) => void;
    focus: () => void;
  };
}

type EditorRowShortcutAction = EditorShortcutAction;

interface EditorRowShortcutKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface EditorRowCommandHandlersResult {
  showTagInsertionUI: boolean;
  toggleTagInsertionUI: () => void;
  closeTagInsertionUI: () => void;
  handleInsertTag: (tagIndex: number) => void;
  handleInsertAllTags: () => void;
  handleCopySourceToTarget: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleSourceCellClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleShortcutAction: (action: EditorRowShortcutAction) => void;
}

export function resolveEditorRowShortcutAction({
  key,
  code,
  ctrlKey,
  metaKey,
  shiftKey,
}: EditorRowShortcutKeyInput): EditorRowShortcutAction {
  return resolveEditorShortcutAction({ key, code, ctrlKey, metaKey, shiftKey });
}

export function useEditorRowCommandHandlers({
  segmentId,
  isActive,
  sourceTags,
  sourceEditorText,
  onActivate,
  onConfirm,
  editorController,
}: UseEditorRowCommandHandlersParams): EditorRowCommandHandlersResult {
  const [showTagInsertionUI, setShowTagInsertionUI] = useState(false);

  const insertAtSelection = useCallback(
    (insertText: string) => {
      if (!editorController.getSnapshot()) return;
      editorController.replaceSelection(insertText);
    },
    [editorController],
  );

  const handleInsertTag = useCallback(
    (tagIndex: number) => {
      if (tagIndex < 0 || tagIndex >= sourceTags.length) return;
      const marker = formatTagAsMemoQMarker(sourceTags[tagIndex].content, tagIndex + 1);
      insertAtSelection(marker);
      setShowTagInsertionUI(false);
    },
    [insertAtSelection, sourceTags],
  );

  const handleInsertAllTags = useCallback(() => {
    if (sourceTags.length === 0) return;
    const allMarkers = sourceTags
      .map((tag, index) => formatTagAsMemoQMarker(tag.content, index + 1))
      .join('');
    insertAtSelection(allMarkers);
    setShowTagInsertionUI(false);
  }, [insertAtSelection, sourceTags]);

  const handleCopySourceToTarget = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onActivate(segmentId);
      editorController.setText(sourceEditorText, false);
      requestAnimationFrame(() => {
        editorController.focus();
      });
    },
    [editorController, onActivate, segmentId, sourceEditorText],
  );

  const handleSourceCellClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onActivate(segmentId, { autoFocusTarget: false });
    },
    [onActivate, segmentId],
  );

  const closeTagInsertionUI = useCallback(() => setShowTagInsertionUI(false), []);

  const toggleTagInsertionUI = useCallback(() => {
    setShowTagInsertionUI((prev) => !prev);
  }, []);

  const handleShortcutAction = useCallback(
    (action: EditorRowShortcutAction) => {
      if (!action) return;
      if (action.type === 'confirm') {
        void onConfirm(segmentId);
        return;
      }
      if (action.type === 'insertAllTags') {
        handleInsertAllTags();
        return;
      }
      handleInsertTag(action.tagIndex);
    },
    [handleInsertAllTags, handleInsertTag, onConfirm, segmentId],
  );

  useEffect(() => {
    if (!isActive) {
      // Reset transient insertion UI when row loses focus.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowTagInsertionUI(false);
    }
  }, [isActive]);

  return {
    showTagInsertionUI,
    toggleTagInsertionUI,
    closeTagInsertionUI,
    handleInsertTag,
    handleInsertAllTags,
    handleCopySourceToTarget,
    handleSourceCellClick,
    handleShortcutAction,
  };
}

export type {
  EditorRowCommandHandlersResult,
  EditorRowShortcutAction,
  EditorRowShortcutKeyInput,
  UseEditorRowCommandHandlersParams,
};
