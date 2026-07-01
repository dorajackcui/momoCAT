import React from 'react';
import { IconButton } from '../ui';

export interface EditorBatchActionBarProps {
  visible: boolean;
  canRunActions: boolean;
  isBatchAITranslating: boolean;
  isBatchAIStopping?: boolean;
  isBatchQARunning: boolean;
  showNonPrintingSymbols: boolean;
  onOpenBatchAIModal: () => void;
  onCancelBatchAITranslate: () => void;
  onRunBatchQA: () => void;
  onToggleNonPrintingSymbols: () => void;
}

function LoadingIcon(): JSX.Element {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v4m0 8v4m8-8h-4M8 12H4m12.364 5.364l-2.828-2.828M9.464 9.464L6.636 6.636m9.728 0l-2.828 2.828m-4.072 4.072l-2.828 2.828"
      />
    </svg>
  );
}

export function EditorBatchActionBar({
  visible,
  canRunActions,
  isBatchAITranslating,
  isBatchAIStopping = false,
  isBatchQARunning,
  showNonPrintingSymbols,
  onOpenBatchAIModal,
  onCancelBatchAITranslate,
  onRunBatchQA,
  onToggleNonPrintingSymbols,
}: EditorBatchActionBarProps): JSX.Element | null {
  if (!visible) return null;

  return (
    <div className="flex items-center justify-start gap-1.5 px-4 py-1.5 border-b border-border bg-surface/90">
      <IconButton
        tone={isBatchAITranslating ? 'danger' : 'brand'}
        size="sm"
        type="button"
        onClick={isBatchAITranslating ? onCancelBatchAITranslate : onOpenBatchAIModal}
        disabled={isBatchAIStopping || !canRunActions}
        aria-label={isBatchAITranslating ? 'Stop AI translation' : 'AI batch translate'}
        title={
          isBatchAITranslating
            ? isBatchAIStopping
              ? 'Stopping AI translation...'
              : 'Stop AI translation'
            : 'AI Batch Translate'
        }
      >
        {isBatchAITranslating ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 6l12 12M18 6L6 18"
            />
          </svg>
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
      </IconButton>

      <IconButton
        tone="neutral"
        size="sm"
        type="button"
        onClick={onRunBatchQA}
        disabled={isBatchQARunning || !canRunActions}
        aria-label="Run batch QA"
        title={isBatchQARunning ? 'Running QA...' : 'Batch QA'}
      >
        {isBatchQARunning ? (
          <LoadingIcon />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5 2a8 8 0 11-16 0 8 8 0 0116 0z"
            />
          </svg>
        )}
      </IconButton>

      <IconButton
        tone={showNonPrintingSymbols ? 'brand' : 'neutral'}
        size="sm"
        type="button"
        onClick={onToggleNonPrintingSymbols}
        disabled={!canRunActions}
        aria-label="Toggle non-printing symbols"
        title={showNonPrintingSymbols ? 'Hide non-printing symbols' : 'Show non-printing symbols'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
      </IconButton>
    </div>
  );
}
