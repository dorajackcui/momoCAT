import React from 'react';
import { ControlGroup, Icon, IconButton } from '../ui';

export interface EditorBatchActionBarProps {
  visible: boolean;
  custom?: boolean;
  canRunActions: boolean;
  isBatchAITranslating: boolean;
  isBatchAIStopping?: boolean;
  isBatchQARunning: boolean;
  onOpenBatchAIModal: () => void;
  onCancelBatchAITranslate: () => void;
  onRunBatchQA: () => void;
}

function LoadingIcon(): JSX.Element {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  custom = false,
  canRunActions,
  isBatchAITranslating,
  isBatchAIStopping = false,
  isBatchQARunning,
  onOpenBatchAIModal,
  onCancelBatchAITranslate,
  onRunBatchQA,
}: EditorBatchActionBarProps): JSX.Element | null {
  if (!visible) return null;
  const operation = custom ? 'processing' : 'translation';

  return (
    <ControlGroup label={custom ? 'Processing tools' : 'Translation tools'} variant="plain">
      <IconButton
        tone={isBatchAITranslating ? 'danger' : 'brand'}
        size="sm"
        type="button"
        onClick={isBatchAITranslating ? onCancelBatchAITranslate : onOpenBatchAIModal}
        disabled={isBatchAIStopping || !canRunActions}
        aria-label={
          isBatchAITranslating
            ? `Stop AI ${operation}`
            : custom
              ? 'AI batch process'
              : 'AI batch translate'
        }
        title={
          isBatchAITranslating
            ? isBatchAIStopping
              ? `Stopping AI ${operation}...`
              : `Stop AI ${operation}`
            : custom
              ? 'AI Batch Process'
              : 'AI Batch Translate'
        }
      >
        {isBatchAITranslating ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 6l12 12M18 6L6 18"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        {isBatchQARunning ? <LoadingIcon /> : <Icon name="shield-alert" />}
      </IconButton>
    </ControlGroup>
  );
}
