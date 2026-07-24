import { EditorState, Compartment, Extension, Prec, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildHighlightChunks, EditorMatchMode } from '../editorFilterUtils';
import { resolveEditorShortcutAction } from './shortcut';
import {
  EditorCommand,
  EditorEngineAdapter,
  EditorEngineCallbacks,
  EditorEngineOptions,
} from './types';

export const codeMirrorEditorThemeSpec = {
  '&.cm-editor': {
    backgroundColor: 'transparent',
    outline: 'none',
    border: 'none',
    height: 'auto',
    overflow: 'hidden',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    overflowX: 'hidden',
    overflowY: 'hidden',
  },
  '.cm-content': {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '0',
    // The shared target layer owns the minimum height. Repeating it here adds
    // the host padding twice and makes a segment grow when it becomes active.
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: 'rgb(var(--color-brand))',
    borderLeftWidth: '2px',
  },
  '.cm-target-highlight': {
    backgroundColor: 'rgba(var(--color-warning), 0.58)',
    boxShadow:
      'inset 0 0 0 1px rgba(var(--color-warning), 0.92), 0 0 0 1px rgba(var(--color-warning), 0.55)',
    borderRadius: '3px',
    color: 'rgb(var(--color-text))',
    fontWeight: '600',
  },
  '.cm-np-space, .cm-np-tab, .cm-np-nbsp, .cm-np-nnbsp': {
    position: 'relative',
    color: 'transparent',
  },
  '.cm-np-space::before, .cm-np-tab::before, .cm-np-nbsp::before, .cm-np-nnbsp::before': {
    position: 'absolute',
    left: '0',
    top: '0',
    color: 'rgb(var(--color-editor-text))',
    opacity: '0.72',
    pointerEvents: 'none',
  },
  '.cm-np-space::before': {
    content: '"·"',
  },
  '.cm-np-tab::before': {
    content: '"⇥"',
  },
  '.cm-np-nbsp::before': {
    content: '"⍽"',
  },
  '.cm-np-nnbsp::before': {
    content: '"⎵"',
  },
  '.cm-np-newline': {
    color: 'rgb(var(--color-editor-text))',
    opacity: '0.72',
    marginLeft: '2px',
    userSelect: 'none',
    pointerEvents: 'none',
  },
};

const editorThemeExtension = EditorView.theme(codeMirrorEditorThemeSpec);

class LineBreakWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-np-newline';
    span.textContent = '↵';
    return span;
  }
}

function buildWhitespaceDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    for (let offset = 0; offset < line.text.length; offset += 1) {
      const char = line.text[offset];
      const pos = line.from + offset;

      if (char === ' ') {
        builder.add(pos, pos + 1, Decoration.mark({ class: 'cm-np-space' }));
        continue;
      }
      if (char === '\t') {
        builder.add(pos, pos + 1, Decoration.mark({ class: 'cm-np-tab' }));
        continue;
      }
      if (char === '\u00A0') {
        builder.add(pos, pos + 1, Decoration.mark({ class: 'cm-np-nbsp' }));
        continue;
      }
      if (char === '\u202F') {
        builder.add(pos, pos + 1, Decoration.mark({ class: 'cm-np-nnbsp' }));
      }
    }

    if (
      line.to < view.state.doc.length &&
      view.state.doc.sliceString(line.to, line.to + 1) === '\n'
    ) {
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          side: 1,
          widget: new LineBreakWidget(),
        }),
      );
    }
  }

  return builder.finish();
}

function nonPrintingExtension(enabled: boolean): Extension {
  if (!enabled) return [];

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildWhitespaceDecorations(view);
      }

      update(update: { docChanged: boolean; view: EditorView }): void {
        if (update.docChanged) {
          this.decorations = buildWhitespaceDecorations(update.view);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    },
  );

  return plugin;
}

function highlightExtension(query: string, mode: EditorMatchMode): Extension {
  if (!query.trim()) return [];

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildHighlightDecorations(view, query, mode);
      }

      update(update: { docChanged: boolean; view: EditorView }): void {
        if (update.docChanged) {
          this.decorations = buildHighlightDecorations(update.view, query, mode);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    },
  );

  return plugin;
}

function buildHighlightDecorations(
  view: EditorView,
  query: string,
  mode: EditorMatchMode,
): DecorationSet {
  const chunks = buildHighlightChunks(view.state.doc.toString(), query, mode);
  const builder = new RangeSetBuilder<Decoration>();
  let cursor = 0;
  for (const chunk of chunks) {
    const start = cursor;
    const end = cursor + chunk.text.length;
    if (chunk.isMatch && end > start) {
      builder.add(start, end, Decoration.mark({ class: 'cm-target-highlight' }));
    }
    cursor = end;
  }
  return builder.finish();
}

function editableExtension(editable: boolean): Extension {
  return [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)];
}

interface CreateCodeMirrorAdapterInput {
  callbacks: EditorEngineCallbacks;
  initialOptions?: Partial<EditorEngineOptions>;
}

const defaultOptions: EditorEngineOptions = {
  editable: true,
  showNonPrintingSymbols: false,
  highlightQuery: '',
  highlightMode: 'contains',
};

export function createCodeMirrorAdapter({
  callbacks,
  initialOptions,
}: CreateCodeMirrorAdapterInput): EditorEngineAdapter {
  let options: EditorEngineOptions = {
    ...defaultOptions,
    ...initialOptions,
  };
  let view: EditorView | null = null;
  let retainedState: EditorState | null = null;

  const editableCompartment = new Compartment();
  const nonPrintingCompartment = new Compartment();
  const highlightCompartment = new Compartment();

  const shortcutExtension = Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event) => {
        const action = resolveEditorShortcutAction({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        if (!action) return false;
        event.preventDefault();
        callbacks.onShortcutAction(action);
        return true;
      },
    }),
  );

  const buildOptionEffects = () => [
    editableCompartment.reconfigure(editableExtension(options.editable)),
    nonPrintingCompartment.reconfigure(nonPrintingExtension(options.showNonPrintingSymbols)),
    highlightCompartment.reconfigure(
      highlightExtension(options.highlightQuery, options.highlightMode),
    ),
  ];

  const applyOptions = (next: Partial<EditorEngineOptions>): void => {
    options = {
      ...options,
      ...next,
    };
    const effects = buildOptionEffects();
    if (view) {
      view.dispatch({ effects });
    } else if (retainedState) {
      retainedState = retainedState.update({ effects }).state;
    }
  };

  return {
    mount: (container, initialText) => {
      if (view) return;
      const state =
        retainedState ??
        EditorState.create({
          doc: initialText,
          extensions: [
            editorThemeExtension,
            history(),
            EditorView.lineWrapping,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            shortcutExtension,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                callbacks.onTextChange(update.state.doc.toString());
              }
              if (update.focusChanged) {
                callbacks.onFocusChange(update.view.hasFocus);
              }
            }),
            editableCompartment.of(editableExtension(options.editable)),
            nonPrintingCompartment.of(nonPrintingExtension(options.showNonPrintingSymbols)),
            highlightCompartment.of(
              highlightExtension(options.highlightQuery, options.highlightMode),
            ),
          ],
        });
      retainedState = null;
      view = new EditorView({
        state,
        parent: container,
      });
    },

    unmount: () => {
      if (!view) return;
      retainedState = view.state;
      view.destroy();
      view = null;
    },

    setText: (nextText, preserveSelection) => {
      const state = view?.state ?? retainedState;
      if (!state) return;
      const prevText = state.doc.toString();
      if (prevText === nextText) return;

      const selection = state.selection.main;
      const nextSelectionFrom = preserveSelection ? Math.min(selection.from, nextText.length) : 0;
      const nextSelectionTo = preserveSelection ? Math.min(selection.to, nextText.length) : 0;

      const transactionSpec = {
        changes: {
          from: 0,
          to: prevText.length,
          insert: nextText,
        },
        selection: {
          anchor: nextSelectionFrom,
          head: nextSelectionTo,
        },
      };
      if (view) {
        view.dispatch(transactionSpec);
      } else {
        retainedState = state.update(transactionSpec).state;
      }
    },

    setEditable: (editable) => {
      applyOptions({ editable });
    },

    setOptions: (nextOptions) => {
      applyOptions(nextOptions);
    },

    focus: () => {
      view?.focus();
    },

    replaceSelection: (insertText) => {
      if (!view) return;
      const selection = view.state.selection.main;
      const nextCursor = selection.from + insertText.length;
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: insertText,
        },
        selection: {
          anchor: nextCursor,
          head: nextCursor,
        },
        scrollIntoView: true,
      });
      view.focus();
    },

    dispatchCommand: (command: EditorCommand) => {
      if (command.type === 'confirm') {
        callbacks.onShortcutAction({ type: 'confirm' });
        return true;
      }
      if (command.type === 'insertAllTags') {
        callbacks.onShortcutAction({ type: 'insertAllTags' });
        return true;
      }
      if (command.type === 'insertTag') {
        callbacks.onShortcutAction({ type: 'insertTag', tagIndex: command.tagIndex });
        return true;
      }
      return false;
    },

    getSnapshot: () => {
      const state = view?.state ?? retainedState;
      if (!state) {
        return {
          text: '',
          selectionFrom: 0,
          selectionTo: 0,
          focused: false,
        };
      }
      const selection = state.selection.main;
      return {
        text: state.doc.toString(),
        selectionFrom: selection.from,
        selectionTo: selection.to,
        focused: view?.hasFocus ?? false,
      };
    },

    destroy: () => {
      view?.destroy();
      view = null;
      retainedState = null;
    },
  };
}
