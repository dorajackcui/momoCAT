import React from 'react';
import type { TBMatch, Token } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import { TMPanel } from '../TMPanel';
import { ConcordancePanel } from '../ConcordancePanel';

interface EditorSidebarProps {
  sidebarWidth: number;
  activeTab: 'tm' | 'concordance';
  setActiveTab: (tab: 'tm' | 'concordance') => void;
  onStartResize: (event: React.MouseEvent<HTMLButtonElement>) => void;
  activeMatches: TMMatch[];
  activeTerms: TBMatch[];
  onApplyMatch: (tokens: Token[]) => void;
  onApplyTerm: (term: string) => void;
  projectId: number;
  concordanceFocusSignal: number;
  concordanceQuery: string;
  concordanceSearchSignal: number;
}

export const EditorSidebar: React.FC<EditorSidebarProps> = ({
  sidebarWidth,
  activeTab,
  setActiveTab,
  onStartResize,
  activeMatches,
  activeTerms,
  onApplyMatch,
  onApplyTerm,
  projectId,
  concordanceFocusSignal,
  concordanceQuery,
  concordanceSearchSignal,
}) => {
  return (
    <div
      className="border-l border-border bg-muted/50 flex-col hidden lg:flex relative"
      style={{ width: `${sidebarWidth}px` }}
    >
      <button
        type="button"
        aria-label="Resize sidebar"
        onMouseDown={onStartResize}
        className="absolute -left-1 top-0 h-full w-2 cursor-col-resize group z-20"
      >
        <span className="absolute left-1/2 -translate-x-1/2 h-full w-[2px] bg-transparent group-hover:bg-brand/40 transition-colors" />
      </button>

      <div className="flex border-b border-border bg-surface">
        <button
          onClick={() => setActiveTab('tm')}
          className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'tm'
              ? 'text-brand border-b-2 border-brand'
              : 'text-text-faint hover:text-text-muted'
          }`}
        >
          CAT
        </button>
        <button
          onClick={() => setActiveTab('concordance')}
          title="Concordance (Ctrl/Cmd+K)"
          className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'concordance'
              ? 'text-brand border-b-2 border-brand'
              : 'text-text-faint hover:text-text-muted'
          }`}
        >
          Concordance
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tm' ? (
          <TMPanel
            matches={activeMatches}
            termMatches={activeTerms}
            onApply={onApplyMatch}
            onApplyTerm={onApplyTerm}
          />
        ) : (
          <ConcordancePanel
            projectId={projectId}
            focusSignal={concordanceFocusSignal}
            externalQuery={concordanceQuery}
            searchSignal={concordanceSearchSignal}
          />
        )}
      </div>
    </div>
  );
};
