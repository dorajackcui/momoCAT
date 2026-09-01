import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorMatchMode } from '../editorFilterUtils';
import {
  EditorEngineAdapter,
  EditorEngineSelection,
  EditorShortcutAction,
} from '../editor-engine/types';
import { useEditorEngineBridge } from '../../hooks/editor/useEditorEngineBridge';
import { shouldSyncDraftFromExternalTarget } from './editorRowUtils';

interface UseEditorRowDraftControllerParams {
  segmentId: string;
  targetEditorText: string;
  targetHighlightQuery: string;
  highlightMode: EditorMatchMode;
  isActive: boolean;
  disableAutoFocus: boolean;
  showNonPrintingSymbols: boolean;
  onAutoFocus?: (id: string) => void;
  onChange: (id: string, value: string) => void;
  onBlur?: (id: string) => Promise<void>;
  onEditStateChange?: (id: string, editing: boolean) => void;
}

interface TargetEditorController {
  getSnapshot: () => {
    text: string;
    selectionFrom: number;
    selectionTo: number;
  } | null;
  setText: (nextText: string, preserveSelection?: boolean) => void;
  replaceSelection: (insertText: string) => void;
  focus: () => void;
}

interface EditorRowDraftControllerResult {
  editorHostRef: RefObject<HTMLDivElement | null>;
  draftText: string;
  emitTranslationChange: (nextText: string) => void;
  setShortcutActionHandler: (handler: (action: EditorShortcutAction) => void) => void;
  capturePendingCaretCoords: (coords: { x: number; y: number }) => void;
  capturePendingSelection: (selection: EditorEngineSelection | null) => void;
  editorController: TargetEditorController;
}

interface SetEditorTextSilentlyParams {
  adapter: Pick<EditorEngineAdapter, 'setText'> | null;
  nextText: string;
  preserveSelection: boolean;
  suppressNextChange: { current: boolean };
}

interface ShouldFinalizeEditorOnDeactivateParams {
  wasActive: boolean;
  isActive: boolean;
  wasFocused: boolean;
}

interface ShouldCompleteEditorBlurParams {
  blurEpoch: number;
  currentFocusEpoch: number;
  isFocused: boolean;
  isMounted: boolean;
}

export function setEditorTextSilently({
  adapter,
  nextText,
  preserveSelection,
  suppressNextChange,
}: SetEditorTextSilentlyParams): void {
  suppressNextChange.current = true;
  try {
    adapter?.setText(nextText, preserveSelection);
  } finally {
    // CodeMirror dispatches update listeners synchronously. Reset here as
    // well so a missing/suspended adapter cannot swallow the next real edit.
    suppressNextChange.current = false;
  }
}

export function shouldFinalizeEditorOnDeactivate({
  wasActive,
  isActive,
  wasFocused,
}: ShouldFinalizeEditorOnDeactivateParams): boolean {
  return wasActive && !isActive && wasFocused;
}

export function shouldCompleteEditorBlur({
  blurEpoch,
  currentFocusEpoch,
  isFocused,
  isMounted,
}: ShouldCompleteEditorBlurParams): boolean {
  return isMounted && blurEpoch === currentFocusEpoch && !isFocused;
}

export function useEditorRowDraftController({
  segmentId,
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
}: UseEditorRowDraftControllerParams): EditorRowDraftControllerResult {
  const wasActiveRef = useRef(false);
  const isMountedRef = useRef(true);
  const [draftText, setDraftText] = useState(targetEditorText);
  const [isDraftSyncSuspended, setIsDraftSyncSuspended] = useState(false);
  const suppressNextEngineChangeRef = useRef(false);
  const editorFocusedRef = useRef(false);
  const focusEpochRef = useRef(0);
  const pendingCaretCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<EditorEngineSelection | null>(null);
  const shortcutActionHandlerRef = useRef<((action: EditorShortcutAction) => void) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const emitTranslationChange = useCallback(
    (nextText: string) => {
      setDraftText(nextText);
      onChange(segmentId, nextText);
    },
    [onChange, segmentId],
  );

  const handleEngineFocusChange = useCallback(
    (focused: boolean) => {
      const focusEpoch = focusEpochRef.current + 1;
      focusEpochRef.current = focusEpoch;
      editorFocusedRef.current = focused;
      if (focused) {
        setIsDraftSyncSuspended(false);
        onEditStateChange?.(segmentId, true);
        return;
      }

      // Pending/in-flight persistence already blocks remote application. Clear
      // the focus-only editing flag immediately so a stale blur completion can
      // never mark a newly focused session as inactive.
      onEditStateChange?.(segmentId, false);
      if (!onBlur) {
        return;
      }

      setIsDraftSyncSuspended(true);
      void onBlur(segmentId)
        .catch(() => {
          // Error state is handled by persistence layer.
        })
        .finally(() => {
          if (
            !shouldCompleteEditorBlur({
              blurEpoch: focusEpoch,
              currentFocusEpoch: focusEpochRef.current,
              isFocused: editorFocusedRef.current,
              isMounted: isMountedRef.current,
            })
          ) {
            return;
          }
          setIsDraftSyncSuspended(false);
        });
    },
    [onBlur, onEditStateChange, segmentId],
  );

  const engineOptions = useMemo(
    () => ({
      editable: isActive,
      showNonPrintingSymbols,
      highlightQuery: targetHighlightQuery,
      highlightMode,
    }),
    [highlightMode, isActive, showNonPrintingSymbols, targetHighlightQuery],
  );

  const { editorHostRef, adapterRef } = useEditorEngineBridge({
    initialText: targetEditorText,
    enabled: isActive,
    options: engineOptions,
    callbacks: {
      onTextChange: (nextText) => {
        if (suppressNextEngineChangeRef.current) {
          suppressNextEngineChangeRef.current = false;
          return;
        }
        emitTranslationChange(nextText);
      },
      onFocusChange: handleEngineFocusChange,
      onShortcutAction: (action) => {
        shortcutActionHandlerRef.current?.(action);
      },
    },
  });

  useEffect(() => {
    if (
      !shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended,
        draftText,
        targetEditorText,
        isActive,
      })
    ) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirror an external store update into the row-local draft and editor session.
    setDraftText(targetEditorText);
    setEditorTextSilently({
      adapter: adapterRef.current,
      nextText: targetEditorText,
      preserveSelection: true,
      suppressNextChange: suppressNextEngineChangeRef,
    });
  }, [adapterRef, draftText, isActive, isDraftSyncSuspended, targetEditorText]);

  useEffect(() => {
    const becameActive = isActive && !wasActiveRef.current;
    const shouldFinalize = shouldFinalizeEditorOnDeactivate({
      wasActive: wasActiveRef.current,
      isActive,
      wasFocused: editorFocusedRef.current,
    });
    if (shouldFinalize) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Deactivation is an external editor lifecycle event that must synchronously begin its flush.
      handleEngineFocusChange(false);
    }
    if (becameActive && !disableAutoFocus) {
      const caretCoords = pendingCaretCoordsRef.current;
      adapterRef.current?.focus(caretCoords ?? undefined, pendingSelectionRef.current ?? undefined);
      onAutoFocus?.(segmentId);
    }
    pendingCaretCoordsRef.current = null;
    pendingSelectionRef.current = null;
    wasActiveRef.current = isActive;
  }, [adapterRef, disableAutoFocus, handleEngineFocusChange, isActive, onAutoFocus, segmentId]);

  useEffect(
    () => () => {
      if (editorFocusedRef.current && onBlur) {
        void onBlur(segmentId).catch(() => {
          // Error state is handled by persistence layer.
        });
      }
      editorFocusedRef.current = false;
      onEditStateChange?.(segmentId, false);
    },
    [onBlur, onEditStateChange, segmentId],
  );

  const setShortcutActionHandler = useCallback(
    (handler: (action: EditorShortcutAction) => void) => {
      shortcutActionHandlerRef.current = handler;
    },
    [],
  );

  const capturePendingCaretCoords = useCallback((coords: { x: number; y: number }) => {
    pendingCaretCoordsRef.current = coords;
  }, []);

  const capturePendingSelection = useCallback((selection: EditorEngineSelection | null) => {
    pendingSelectionRef.current = selection;
  }, []);

  const editorController = useMemo(
    () => ({
      getSnapshot: () => {
        const adapter = adapterRef.current;
        if (!adapter) return null;
        const snapshot = adapter.getSnapshot();
        return {
          text: snapshot.text,
          selectionFrom: snapshot.selectionFrom,
          selectionTo: snapshot.selectionTo,
        };
      },
      setText: (nextText: string, preserveSelection: boolean = false) => {
        setDraftText(nextText);
        setEditorTextSilently({
          adapter: adapterRef.current,
          nextText,
          preserveSelection,
          suppressNextChange: suppressNextEngineChangeRef,
        });
        onChange(segmentId, nextText);
      },
      replaceSelection: (insertText: string) => {
        adapterRef.current?.replaceSelection(insertText);
      },
      focus: () => {
        adapterRef.current?.focus();
      },
    }),
    [adapterRef, onChange, segmentId],
  );

  return {
    editorHostRef,
    draftText,
    emitTranslationChange,
    setShortcutActionHandler,
    capturePendingCaretCoords,
    capturePendingSelection,
    editorController,
  };
}

export type {
  EditorRowDraftControllerResult,
  TargetEditorController,
  UseEditorRowDraftControllerParams,
};
