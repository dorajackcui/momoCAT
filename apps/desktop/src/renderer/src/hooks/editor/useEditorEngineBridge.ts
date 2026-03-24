import { RefObject, useEffect, useRef } from 'react';
import { createCodeMirrorAdapter } from '../../components/editor-engine/codemirrorAdapter';
import {
  EditorEngineAdapter,
  EditorEngineCallbacks,
  EditorEngineOptions,
} from '../../components/editor-engine/types';

interface UseEditorEngineBridgeParams {
  initialText: string;
  options: EditorEngineOptions;
  callbacks: EditorEngineCallbacks;
}

interface UseEditorEngineBridgeResult {
  editorHostRef: RefObject<HTMLDivElement | null>;
  adapterRef: RefObject<EditorEngineAdapter | null>;
}

export function useEditorEngineBridge({
  initialText,
  options,
  callbacks,
}: UseEditorEngineBridgeParams): UseEditorEngineBridgeResult {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EditorEngineAdapter | null>(null);
  const initialTextRef = useRef(initialText);
  const initialOptionsRef = useRef(options);
  const callbackRef = useRef(callbacks);

  useEffect(() => {
    callbackRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const adapter = createCodeMirrorAdapter({
      callbacks: {
        onTextChange: (nextText) => callbackRef.current.onTextChange(nextText),
        onFocusChange: (focused) => callbackRef.current.onFocusChange(focused),
        onShortcutAction: (action) => callbackRef.current.onShortcutAction(action),
      },
      initialOptions: initialOptionsRef.current,
    });
    adapterRef.current = adapter;
    adapter.mount(host, initialTextRef.current);
    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    adapterRef.current?.setOptions({
      editable: options.editable,
      showNonPrintingSymbols: options.showNonPrintingSymbols,
      highlightQuery: options.highlightQuery,
      highlightMode: options.highlightMode,
    });
  }, [
    options.editable,
    options.highlightMode,
    options.highlightQuery,
    options.showNonPrintingSymbols,
  ]);

  return {
    editorHostRef,
    adapterRef,
  };
}

export type { UseEditorEngineBridgeParams, UseEditorEngineBridgeResult };
