import { useMemo } from 'react';
import type { Token } from '@cat/core/models';
import { buildSourceDiff, type SourceDiffPart } from './sourceDiff';

interface SourceDiffPaneProps {
  tmSourceTokens: Token[];
  currentSourceTokens: Token[];
  sourceLocale?: string | null;
}

function DiffLine({
  parts,
  visibleChange,
}: {
  parts: SourceDiffPart[];
  visibleChange: 'remove' | 'add';
}) {
  return (
    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text">
      {parts
        .filter((part) => part.kind === 'equal' || part.kind === visibleChange)
        .map((part, index) => (
          <span
            key={`${part.kind}-${index}`}
            className={
              part.kind === 'remove'
                ? 'rounded-[2px] bg-danger-soft text-danger'
                : part.kind === 'add'
                  ? 'rounded-[2px] bg-success-soft text-success'
                  : undefined
            }
          >
            {part.text}
          </span>
        ))}
    </p>
  );
}

export function SourceDiffPane({
  tmSourceTokens,
  currentSourceTokens,
  sourceLocale,
}: SourceDiffPaneProps) {
  const parts = useMemo(
    () => buildSourceDiff(tmSourceTokens, currentSourceTokens, sourceLocale),
    [currentSourceTokens, sourceLocale, tmSourceTokens],
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-surface">
      <section
        className="quiet-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3"
        aria-label="TM source"
      >
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-faint">
          TM source
        </div>
        <DiffLine parts={parts} visibleChange="remove" />
      </section>
      <section
        className="quiet-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-border/60 px-3 py-3"
        aria-label="Current source"
      >
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-faint">
          Current
        </div>
        <DiffLine parts={parts} visibleChange="add" />
      </section>
    </div>
  );
}
