import React, { useMemo, useState } from 'react';
import type { TBMatch, TMEntry, Token } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { SourceDiffPane } from './tm-panel/SourceDiffPane';

export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;

interface TMPanelProps {
  matches: TMMatch[];
  termMatches: TBMatch[];
  activeSegmentId: string | null;
  currentSourceTokens: Token[];
  sourceLocale?: string | null;
  loading?: boolean;
  onApply: (tokens: Token[]) => void;
  onApplyTerm: (term: string) => void;
}

export type CombinedMatch =
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

type CombinedTMMatch = Extract<CombinedMatch, { kind: 'tm' }>;

export function buildCombinedMatches(
  matches: TMMatch[],
  termMatches: TBMatch[],
  tmRenderLimit: number,
): CombinedMatch[] {
  return [
    ...(matches || []).slice(0, tmRenderLimit).map((match) => ({
      kind: 'tm' as const,
      rank: match.rank,
      id: `tm-${match.kind}-${match.id}`,
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

export function resolveSelectedTMMatch(
  combined: CombinedMatch[],
  selectedId?: string | null,
): CombinedTMMatch | null {
  const selected = selectedId
    ? combined.find((item): item is CombinedTMMatch => item.kind === 'tm' && item.id === selectedId)
    : undefined;
  return selected ?? combined.find((item): item is CombinedTMMatch => item.kind === 'tm') ?? null;
}

export const TMPanel: React.FC<TMPanelProps> = ({
  matches,
  termMatches,
  activeSegmentId,
  currentSourceTokens,
  sourceLocale,
  loading,
  onApply,
  onApplyTerm,
}) => {
  const TM_RENDER_LIMIT = 5;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const combined = useMemo(
    () => buildCombinedMatches(matches, termMatches, TM_RENDER_LIMIT),
    [matches, termMatches],
  );
  const selectedTM = useMemo(
    () => resolveSelectedTMMatch(combined, selectedId),
    [combined, selectedId],
  );

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-faint p-6 text-center">
        <div className="mb-2 text-2xl">🔍</div>
        <p className="text-xs">Searching...</p>
      </div>
    );
  }

  if (combined.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-faint p-6 text-center">
        <div className="mb-2 text-2xl">🔍</div>
        <p className="text-xs">No TM/TB matches found for the current segment.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      <div
        className={
          selectedTM && activeSegmentId
            ? 'quiet-scrollbar min-h-0 basis-3/5 overflow-y-auto'
            : 'quiet-scrollbar min-h-0 flex-1 overflow-y-auto'
        }
      >
        {combined.map((item) => {
          const isTM = item.kind === 'tm';
          const match = item.payload;
          const tmMatch = isTM ? (match as TMMatch) : null;
          const tbMatch = !isTM ? (match as TBMatch) : null;
          const tmLabel = isTM
            ? tmMatch!.kind === 'concordance'
              ? `Concordance: ${tmMatch!.tmName}`
              : tmMatch!.tmType === 'working'
                ? 'Working TM'
                : `Main TM: ${tmMatch!.tmName}`
            : `Term Base: ${tbMatch!.tbName}`;
          const scoreBg = isTM
            ? tmMatch!.kind === 'concordance'
              ? 'bg-[#808080]'
              : tmMatch!.similarity >= 100
                ? 'bg-success'
                : 'bg-warning'
            : 'bg-[#B8930B]';
          const scoreText = isTM
            ? tmMatch!.kind === 'concordance'
              ? 'C'
              : String(tmMatch!.similarity)
            : 'TB';
          const key = item.id;
          const sourceText = item.sourceText;
          const targetText = item.targetText;
          const isSelected = isTM && selectedTM?.id === item.id;

          return (
            <div
              key={key}
              className={`border-l-2 border-b border-border/60 last:border-b-0 ${
                isSelected ? 'border-l-border bg-muted/60' : 'border-l-transparent'
              }`}
            >
              <div className="px-2 py-1 flex items-center justify-between text-[9px] text-text-faint">
                <span className="truncate">{tmLabel}</span>
                <span>{isTM && ` · ${new Date(tmMatch!.updatedAt).toLocaleDateString()}`}</span>
              </div>

              <div
                className={`group grid grid-cols-[1fr_20px_1fr] items-stretch cursor-pointer transition-colors ${
                  isSelected ? '' : 'hover:bg-muted/30'
                }`}
                onClick={() => {
                  if (!isTM) return;
                  setSelectedId(item.id);
                }}
                onDoubleClick={() => {
                  if (isTM) {
                    onApply(tmMatch!.targetTokens);
                  } else {
                    onApplyTerm(tbMatch!.tgtTerm);
                  }
                }}
                title="Double click to apply match"
              >
                <div
                  className={`px-2 py-2 border-r border-border/60 text-xs text-text-muted leading-snug ${
                    isTM ? 'line-clamp-5' : ''
                  }`}
                >
                  {sourceText}
                </div>

                <div className={`${scoreBg} text-white flex items-center justify-center px-[1px]`}>
                  <span className="text-[8px] font-bold leading-none whitespace-nowrap">
                    {scoreText}
                  </span>
                </div>

                <div
                  className={`px-2 py-2 border-l border-border/60 text-xs text-text leading-snug ${
                    isTM ? 'line-clamp-5' : ''
                  }`}
                >
                  {targetText}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedTM && activeSegmentId && (
        <div className="min-h-0 basis-2/5 border-t border-border">
          <SourceDiffPane
            tmSourceTokens={selectedTM.payload.sourceTokens}
            currentSourceTokens={currentSourceTokens}
            sourceLocale={sourceLocale}
          />
        </div>
      )}
    </div>
  );
};
