import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { QaSeverity, Segment } from '@cat/core/models';
import { buildHighlightChunks, type EditorMatchMode } from '../editorFilterUtils';

interface EditorRowFeedbackProps {
  qaIssues: NonNullable<Segment['qaIssues']>;
  saveError?: string;
  contextText?: string;
  contextHighlightQuery?: string;
  highlightMode?: EditorMatchMode;
}

function FeedbackLine({
  severity,
  label,
  children,
}: {
  severity: QaSeverity;
  label: string;
  children: React.ReactNode;
}) {
  const tone =
    severity === 'error' ? 'text-danger' : severity === 'warning' ? 'text-warning' : 'text-info';
  return (
    <div className="flex items-start gap-1.5 px-1 py-0.5 text-[11px] text-text-muted">
      <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${tone}`}>
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          {severity === 'warning' ? (
            <path strokeLinejoin="round" d="M12 3 22 21H2L12 3Z" />
          ) : (
            <circle cx="12" cy="12" r="9" />
          )}
          {severity === 'info' ? (
            <path strokeLinecap="round" d="M12 11v6m0-10v.1" />
          ) : (
            <path strokeLinecap="round" d="M12 8v5m0 4v.1" />
          )}
        </svg>
        <span className="capitalize">{label}</span>
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
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
  contextHighlightQuery = '',
  highlightMode = 'contains',
}) => {
  const [contextCopied, setContextCopied] = useState(false);
  const contextCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (contextCopiedTimerRef.current !== null) {
        window.clearTimeout(contextCopiedTimerRef.current);
      }
    };
  }, []);

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
  const contextContent = contextHighlightQuery.trim()
    ? buildHighlightChunks(contextText, contextHighlightQuery, highlightMode).map((chunk, index) =>
        chunk.isMatch ? (
          <mark key={index} className="cm-target-highlight">
            {chunk.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{chunk.text}</React.Fragment>
        ),
      )
    : contextText;

  return (
    <>
      {qaIssues.length > 0 && (
        <div className="mt-1 space-y-1">
          {qaIssues.map((issue, idx) => (
            <FeedbackLine key={idx} severity={issue.severity} label={issue.severity}>
              {issue.message}
            </FeedbackLine>
          ))}
        </div>
      )}

      {saveError && (
        <div className="mt-1">
          <FeedbackLine severity="error" label="save">
            {saveError}
          </FeedbackLine>
        </div>
      )}

      {contextText && (
        <div className="mt-auto px-1 pt-1 max-w-full overflow-hidden group">
          <div
            onClick={(event) => void handleCopyContext(event)}
            title={contextText}
            className="flex min-w-0 max-w-full items-center gap-1 text-[10px] text-text-faint italic leading-4 cursor-copy hover:text-text-muted transition-colors"
          >
            <span className="block min-w-0 flex-1 truncate whitespace-nowrap">
              {contextContent}
            </span>
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-success">
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
