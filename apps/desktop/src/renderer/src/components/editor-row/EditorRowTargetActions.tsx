import React, { useRef, useState } from 'react';
import { Button, ControlGroup, Input, IconButton, Popover } from '../ui';
import { normalizeRefinementInstruction } from './editorRowUtils';

interface EditorRowTargetActionsProps {
  tagMenuAnchorRef: React.Ref<HTMLButtonElement>;
  isTagMenuOpen: boolean;
  hasRefinableTarget: boolean;
  isAIBusy: boolean;
  canAITranslate: boolean;
  canInsertTags: boolean;
  onAIRefine: (instruction: string) => void;
  onAITranslate: () => void;
  onFocusTarget: () => void;
  onToggleTagInsertionUI: () => void;
}

export const EditorRowTargetActions: React.FC<EditorRowTargetActionsProps> = ({
  tagMenuAnchorRef,
  isTagMenuOpen,
  hasRefinableTarget,
  isAIBusy,
  canAITranslate,
  canInsertTags,
  onAIRefine,
  onAITranslate,
  onFocusTarget,
  onToggleTagInsertionUI,
}) => {
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const prompt = normalizeRefinementInstruction(instruction);
  const aiLabel = hasRefinableTarget ? 'AI refine this translation' : 'AI translate this segment';

  const closeRefine = () => {
    setRefineOpen(false);
    setInstruction('');
  };
  const submitRefine = () => {
    if (isAIBusy || !prompt) return;
    closeRefine();
    onAIRefine(prompt);
    onFocusTarget();
  };

  return (
    <>
      {(canAITranslate || canInsertTags) && (
        <ControlGroup
          label="Segment actions"
          orientation="vertical"
          className="absolute top-1.5 right-1.5 z-20"
        >
          {canAITranslate && (
            <IconButton
              ref={aiButtonRef}
              size="xs"
              tone="brand"
              variant="overlay"
              disabled={isAIBusy}
              aria-busy={isAIBusy}
              aria-haspopup={hasRefinableTarget ? 'dialog' : undefined}
              aria-expanded={hasRefinableTarget ? refineOpen : undefined}
              title={aiLabel}
              aria-label={aiLabel}
              onClick={(event) => {
                event.stopPropagation();
                if (hasRefinableTarget) {
                  if (refineOpen) closeRefine();
                  else setRefineOpen(true);
                } else {
                  onAITranslate();
                }
              }}
            >
              <svg
                className={`w-3.5 h-3.5 ${isAIBusy ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={
                    isAIBusy
                      ? 'M12 4v4m0 8v4m8-8h-4M8 12H4m12.364 5.364l-2.828-2.828M9.464 9.464L6.636 6.636m9.728 0l-2.828 2.828m-4.072 4.072l-2.828 2.828'
                      : 'M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z'
                  }
                />
              </svg>
            </IconButton>
          )}
          {canInsertTags && (
            <IconButton
              size="xs"
              tone="brand"
              variant="overlay"
              ref={tagMenuAnchorRef}
              aria-haspopup="menu"
              aria-expanded={isTagMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                onToggleTagInsertionUI();
              }}
              title="Insert tags from source (Ctrl/Cmd+Shift+1-9)"
              aria-label="Toggle tag insertion menu"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            </IconButton>
          )}
        </ControlGroup>
      )}
      <Popover
        open={refineOpen && hasRefinableTarget && canAITranslate}
        anchor={aiButtonRef}
        label="Refine translation"
        placement="bottom-end"
        className="w-64 max-w-[calc(100vw-16px)]"
        onClose={closeRefine}
      >
        <div
          className="space-y-2"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeRefine();
            onFocusTarget();
          }}
        >
          <Input
            size="xs"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              submitRefine();
            }}
            disabled={isAIBusy}
            placeholder="e.g. Make it more concise"
            aria-label="AI refine instruction"
          />
          <div className="flex items-center justify-between gap-2 text-xs">
            <Button
              variant="link"
              tone="neutral"
              disabled={isAIBusy}
              title="Translate again from source, replacing the current translation"
              onClick={() => {
                closeRefine();
                onAITranslate();
                onFocusTarget();
              }}
            >
              Retranslate
            </Button>
            <Button
              variant="primary"
              size="xs"
              disabled={isAIBusy || !prompt}
              onClick={submitRefine}
            >
              Refine ↵
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
};
