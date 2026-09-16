import { Input } from '../ui';
import React from 'react';

interface EditorRowTargetActionsProps {
  tagMenuAnchorRef: React.Ref<HTMLButtonElement>;
  isTagMenuOpen: boolean;
  aiRefineInputRef: React.Ref<HTMLInputElement>;
  showAIRefineInput: boolean;
  showAIRefineControl: boolean;
  showTargetActionButtons: boolean;
  aiRefineDraft: string;
  isAIRefining: boolean;
  isAITranslating: boolean;
  canAITranslate: boolean;
  canInsertTags: boolean;
  onAiRefineDraftChange: (value: string) => void;
  onAIRefineInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggleAIRefineInput: () => void;
  onAITranslate: () => void;
  onToggleTagInsertionUI: () => void;
}

const LoadingSpinnerIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4v4m0 8v4m8-8h-4M8 12H4m12.364 5.364l-2.828-2.828M9.464 9.464L6.636 6.636m9.728 0l-2.828 2.828m-4.072 4.072l-2.828 2.828"
    />
  </svg>
);

export const EditorRowTargetActions: React.FC<EditorRowTargetActionsProps> = ({
  tagMenuAnchorRef,
  isTagMenuOpen,
  aiRefineInputRef,
  showAIRefineInput,
  showAIRefineControl,
  showTargetActionButtons,
  aiRefineDraft,
  isAIRefining,
  isAITranslating,
  canAITranslate,
  canInsertTags,
  onAiRefineDraftChange,
  onAIRefineInputKeyDown,
  onToggleAIRefineInput,
  onAITranslate,
  onToggleTagInsertionUI,
}) => (
  <>
    {showAIRefineInput && showAIRefineControl && (
      <div className="absolute top-1.5 right-9 z-30">
        <Input
          ref={aiRefineInputRef}
          value={aiRefineDraft}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onAiRefineDraftChange(event.target.value)}
          onKeyDown={onAIRefineInputKeyDown}
          disabled={isAIRefining}
          placeholder="Refine prompt(Enter to send)"
          className="!w-56 !px-2.5 !py-1 text-[11px] leading-tight !bg-surface/50 border-border/70 backdrop-blur-sm shadow-sm disabled:opacity-60 disabled:cursor-wait"
          aria-label="AI refine instruction"
        />
      </div>
    )}

    <div
      className={`absolute top-1.5 right-1.5 z-20 flex min-w-[30px] flex-col items-end gap-1 transition-opacity ${
        showTargetActionButtons ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {showAIRefineControl && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (isAIRefining) return;
            onToggleAIRefineInput();
          }}
          disabled={isAIRefining}
          className="relative z-20 p-1 rounded bg-surface/80 border border-border/70 hover:bg-brand-soft/75 hover:border-brand/40 text-text-muted hover:text-brand transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait"
          title="AI refine this translation"
          aria-label="AI refine this translation"
        >
          {isAIRefining ? (
            <LoadingSpinnerIcon />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 18h18M7 18c0-6 3-10 5-10s5 4 5 10"
              />
            </svg>
          )}
        </button>
      )}

      {canAITranslate && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAITranslate();
          }}
          disabled={isAITranslating}
          className="relative z-20 p-1 rounded bg-surface/70 border border-border/70 hover:bg-brand-soft/75 hover:border-brand/40 text-text-muted hover:text-brand transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait"
          title="AI translate this segment"
          aria-label="AI translate this segment"
        >
          {isAITranslating ? (
            <LoadingSpinnerIcon />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z"
              />
            </svg>
          )}
        </button>
      )}

      {canInsertTags && (
        <button
          ref={tagMenuAnchorRef}
          aria-haspopup="menu"
          aria-expanded={isTagMenuOpen}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleTagInsertionUI();
          }}
          className="relative z-20 p-1 rounded bg-surface/90 border border-border/80 hover:bg-brand-soft/80 hover:border-brand/40 text-text-muted hover:text-brand transition-all shadow-sm"
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
        </button>
      )}
    </div>
  </>
);
