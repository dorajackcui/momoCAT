import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@cat/core/models';

interface EditorRowFeedbackProps {
  qaIssues: NonNullable<Segment['qaIssues']>;
  saveError?: string;
  contextText?: string;
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', 'true');
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    temp.style.pointerEvents = 'none';
    document.body.appendChild(temp);
    temp.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(temp);
    return copied;
  } catch {
    return false;
  }
}

export const EditorRowFeedback: React.FC<EditorRowFeedbackProps> = ({
  qaIssues,
  saveError,
  contextText = '',
}) => {
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [contextCopied, setContextCopied] = useState(false);
  const contextCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (contextCopiedTimerRef.current !== null) {
        window.clearTimeout(contextCopiedTimerRef.current);
      }
    };
  }, []);

  const isLongContext = contextText.length > 120;
  const displayContext = useMemo(
    () =>
      isContextExpanded || !isLongContext ? contextText : `${contextText.substring(0, 110)}...`,
    [contextText, isContextExpanded, isLongContext],
  );

  const handleCopyContext = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!contextText.trim()) return;
      const copied = await copyText(contextText);
      if (!copied) return;

      setContextCopied(true);
      if (contextCopiedTimerRef.current !== null) {
        window.clearTimeout(contextCopiedTimerRef.current);
      }
      contextCopiedTimerRef.current = window.setTimeout(() => {
        setContextCopied(false);
      }, 1200);
    },
    [contextText],
  );

  return (
    <>
      {qaIssues.length > 0 && (
        <div className="mt-1 space-y-1">
          {qaIssues.map((issue, idx) => (
            <div
              key={idx}
              className={`text-[10px] flex items-center gap-1.5 px-2 py-0.5 rounded ${
                issue.severity === 'error'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-warning-soft text-warning'
              }`}
            >
              <span className="font-bold uppercase text-[8px]">{issue.severity}:</span>
              {issue.message}
            </div>
          ))}
        </div>
      )}

      {saveError && (
        <div className="mt-1 text-[10px] flex items-center gap-1.5 px-2 py-0.5 rounded bg-danger-soft text-danger">
          <span className="font-bold uppercase text-[8px]">save:</span>
          {saveError}
        </div>
      )}

      {contextText && (
        <div className="mt-1 px-1 group">
          <div
            onClick={(event) => void handleCopyContext(event)}
            title="Click to copy context"
            className="text-[11px] text-text-faint italic leading-snug cursor-copy hover:text-text-muted transition-colors"
          >
            {displayContext}
            {isLongContext && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setIsContextExpanded((prev) => !prev);
                }}
                className="ml-1 text-brand hover:text-brand font-medium not-italic"
              >
                {isContextExpanded ? 'Collapse' : 'more'}
              </button>
            )}
            <span className="ml-1 inline-flex h-3 w-3 items-center justify-center text-success">
              <svg
                className={`w-3 h-3 transition-opacity duration-150 ${contextCopied ? 'opacity-100' : 'opacity-0'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-label={contextCopied ? 'Context copied' : undefined}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </span>
          </div>
        </div>
      )}
    </>
  );
};
