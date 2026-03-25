import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Token } from '@cat/core/models';
import { formatTagAsMemoQMarker } from '@cat/core/tag';
import { resolveEditorShortcutAction } from '../editor-engine/shortcut';
import { EditorShortcutAction } from '../editor-engine/types';
import { normalizeRefinementInstruction } from './editorRowUtils';

interface UseEditorRowCommandHandlersParams {
  segmentId: string;
  isActive: boolean;
  isAIRefining: boolean;
  sourceTags: Token[];
  sourceEditorText: string;
  onActivate: (id: string, options?: { autoFocusTarget?: boolean }) => void;
  onAIRefine: (id: string, instruction: string) => void;
  onConfirm: (id: string) => void;
  editorController: {
    getSnapshot: () =>
      | {
          text: string;
          selectionFrom: number;
          selectionTo: number;
        }
      | null;
    setText: (nextText: string, preserveSelection?: boolean) => void;
    replaceSelection: (insertText: string) => void;
    focus: () => void;
  };
}

type EditorRowShortcutAction = EditorShortcutAction;

interface EditorRowShortcutKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface EditorRowCommandHandlersResult {
  aiRefineInputRef: React.RefObject<HTMLInputElement | null>;
  showTagInsertionUI: boolean;
  showAIRefineInput: boolean;
  aiRefineDraft: string;
  setAiRefineDraft: React.Dispatch<React.SetStateAction<string>>;
  toggleTagInsertionUI: () => void;
  toggleAIRefineInput: () => void;
  handleInsertTag: (tagIndex: number) => void;
  handleInsertAllTags: () => void;
  handleCopySourceToTarget: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleSourceCellClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleAIRefineInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleShortcutAction: (action: EditorRowShortcutAction) => void;
}

export function resolveEditorRowShortcutAction({
  key,
  ctrlKey,
  metaKey,
  shiftKey,
}: EditorRowShortcutKeyInput): EditorRowShortcutAction {
  return resolveEditorShortcutAction({ key, ctrlKey, metaKey, shiftKey });
}

export function useEditorRowCommandHandlers({
  segmentId,
  isActive,
  isAIRefining,
  sourceTags,
  sourceEditorText,
  onActivate,
  onAIRefine,
  onConfirm,
  editorController,
}: UseEditorRowCommandHandlersParams): EditorRowCommandHandlersResult {
  const aiRefineInputRef = useRef<HTMLInputElement>(null);
  const [showTagInsertionUI, setShowTagInsertionUI] = useState(false);
  const [showAIRefineInput, setShowAIRefineInput] = useState(false);
  const [aiRefineDraft, setAiRefineDraft] = useState('');

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

  const submitAIRefinement = useCallback(() => {
    if (isAIRefining) return;
    const instruction = normalizeRefinementInstruction(aiRefineDraft);
    if (!instruction) return;
    onAIRefine(segmentId, instruction);
    setShowAIRefineInput(false);
    setAiRefineDraft('');
  }, [aiRefineDraft, isAIRefining, onAIRefine, segmentId]);

  const toggleAIRefineInput = useCallback(() => {
    setShowAIRefineInput((prev) => {
      const next = !prev;
      if (!next) {
        setAiRefineDraft('');
      }
      return next;
    });
  }, []);

  const toggleTagInsertionUI = useCallback(() => {
    setShowTagInsertionUI((prev) => !prev);
  }, []);

  const handleAIRefineInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        submitAIRefinement();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShowAIRefineInput(false);
        setAiRefineDraft('');
      }
    },
    [submitAIRefinement],
  );

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowAIRefineInput(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAiRefineDraft('');
    }
  }, [isActive]);

  useEffect(() => {
    if (!showAIRefineInput || !isActive) return;
    aiRefineInputRef.current?.focus();
    aiRefineInputRef.current?.select();
  }, [isActive, showAIRefineInput]);

  return {
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
  };
}

export type {
  EditorRowCommandHandlersResult,
  EditorRowShortcutAction,
  EditorRowShortcutKeyInput,
  UseEditorRowCommandHandlersParams,
};
