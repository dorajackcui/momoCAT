import React, { useState } from 'react';
import type { TBMatch, TMEntry, Token } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';

export interface TMMatch extends TMEntry {
  similarity: number;
  tmName: string;
  tmType: 'working' | 'main';
}

interface TMPanelProps {
  matches: TMMatch[];
  termMatches: TBMatch[];
  onApply: (tokens: Token[]) => void;
  onApplyTerm: (term: string) => void;
}

type CombinedMatch =
  | {
      kind: 'tm';
      rank: number;
      id: string;
      sourceText: string;
      targetText: string;
      payload: TMMatch;
    }
  | {
      kind: 'tb';
      rank: number;
      id: string;
      sourceText: string;
      targetText: string;
      payload: TBMatch;
    };

export function buildCombinedMatches(
  matches: TMMatch[],
  termMatches: TBMatch[],
  tmRenderLimit: number,
): CombinedMatch[] {
  return [
    ...(matches || []).slice(0, tmRenderLimit).map((match, idx) => ({
      kind: 'tm' as const,
      rank: match.similarity,
      id: `tm-${match.id}-${idx}`,
      sourceText: serializeTokensToDisplayText(match.sourceTokens),
      targetText: serializeTokensToDisplayText(match.targetTokens),
      payload: match,
    })),
    ...(termMatches || []).map((match, idx) => ({
      kind: 'tb' as const,
      rank: 99,
      id: `tb-${match.id}-${idx}`,
      sourceText: match.srcTerm,
      targetText: match.tgtTerm,
      payload: match,
    })),
  ].sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (a.kind !== b.kind) return a.kind === 'tm' ? -1 : 1;
    return 0;
  });
}

export const TMPanel: React.FC<TMPanelProps> = ({ matches, termMatches, onApply, onApplyTerm }) => {
  const TM_RENDER_LIMIT = 5;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const truncate = (text: string, limit: number) => {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}...`;
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const combined = buildCombinedMatches(matches, termMatches, TM_RENDER_LIMIT);

  if (combined.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-faint p-6 text-center">
        <div className="mb-2 text-2xl">🔍</div>
        <p className="text-xs">No TM/TB matches found for the current segment.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* <div className="px-2 py-2 border-b border-border/60">
        <span className="text-[10px] text-text-faint">{combined.length} matches found</span>
      </div> */}

      <div className="flex-1 overflow-y-auto">
        {combined.map((item) => {
          const isTM = item.kind === 'tm';
          const match = item.payload;
          const tmMatch = isTM ? (match as TMMatch) : null;
          const tbMatch = !isTM ? (match as TBMatch) : null;
          const tmLabel = isTM
            ? tmMatch!.tmType === 'working'
              ? 'Working TM'
              : `Main TM: ${tmMatch!.tmName}`
            : `Term Base: ${tbMatch!.tbName}`;
          const scoreBg = isTM
            ? tmMatch!.similarity >= 95
              ? 'bg-success'
              : tmMatch!.similarity >= 85
                ? 'bg-brand'
                : 'bg-warning'
            : 'bg-warning';
          const scoreText = isTM ? String(tmMatch!.similarity) : 'TB';
          const key = item.id;
          const sourceText = item.sourceText;
          const targetText = item.targetText;
          const isExpanded = !!expanded[key];
          const hasLongSource = sourceText.length > 180;
          const hasLongTarget = targetText.length > 180;

          return (
            <div key={key} className="border-b border-border/60 last:border-b-0">
              <div className="px-2 py-1 flex items-center justify-between text-[9px] text-text-faint bg-muted/40">
                <span className="truncate">{tmLabel}</span>
                <span>{isTM && ` · ${new Date(tmMatch!.updatedAt).toLocaleDateString()}`}</span>
              </div>

              <div
                className="group grid grid-cols-[1fr_20px_1fr] items-stretch cursor-pointer hover:bg-brand-soft/30 transition-colors"
                onDoubleClick={() => {
                  if (isTM) {
                    onApply(tmMatch!.targetTokens);
                  } else {
                    onApplyTerm(tbMatch!.tgtTerm);
                  }
                }}
                title="Double click to apply match"
              >
                <div className="px-2 py-2 border-r border-border/60 text-xs text-text-muted leading-snug">
                  {isExpanded ? sourceText : truncate(sourceText, 170)}
                  {hasLongSource && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(key);
                      }}
                      className="ml-1 text-[10px] text-brand hover:underline"
                    >
                      {isExpanded ? 'less' : '...'}
                    </button>
                  )}
                </div>

                <div className={`${scoreBg} text-white flex items-center justify-center px-[1px]`}>
                  <span className="text-[8px] font-bold leading-none whitespace-nowrap">
                    {scoreText}
                  </span>
                </div>

                <div className="px-2 py-2 border-l border-border/60 text-xs text-text leading-snug">
                  {isExpanded ? targetText : truncate(targetText, 300)}
                  {hasLongTarget && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(key);
                      }}
                      className="ml-1 text-[10px] text-brand hover:underline not-italic"
                    >
                      {isExpanded ? 'less' : '...'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
