import { Tabs, TabsList, TabsPanel } from '../ui';
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
  activeSegmentId: string | null;
  activeSourceTokens: Token[];
  activeMatches: TMMatch[];
  activeTerms: TBMatch[];
  sourceLocale?: string | null;
  referenceLoading: boolean;
  onApplyMatch: (tokens: Token[]) => void;
  onApplyTerm: (term: string) => void;
  projectId: number;
  concordanceFocusSignal: number;
  concordanceQuery: string;
  concordanceSearchSignal: number;
}

const EditorSidebarComponent: React.FC<EditorSidebarProps> = ({
  sidebarWidth,
  activeTab,
  setActiveTab,
  onStartResize,
  activeSegmentId,
  activeSourceTokens,
  activeMatches,
  activeTerms,
  sourceLocale,
  referenceLoading,
  onApplyMatch,
  onApplyTerm,
  projectId,
  concordanceFocusSignal,
  concordanceQuery,
  concordanceSearchSignal,
}) => {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as 'tm' | 'concordance')}
      className="border-l border-border-subtle bg-surface-panel flex-col hidden lg:flex relative"
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

      <TabsList
        label="Editor references"
        variant="segmented"
        items={[
          { value: 'tm', label: 'CAT' },
          { value: 'concordance', label: 'Concordance', title: 'Concordance (Ctrl/Cmd+K)' },
        ]}
      />

      <TabsPanel value={activeTab} className="flex-1 min-h-0">
        {activeTab === 'tm' ? (
          <TMPanel
            key={activeSegmentId ?? 'no-active-segment'}
            matches={activeMatches}
            termMatches={activeTerms}
            activeSegmentId={activeSegmentId}
            currentSourceTokens={activeSourceTokens}
            sourceLocale={sourceLocale}
            loading={referenceLoading}
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
      </TabsPanel>
    </Tabs>
  );
};

export const EditorSidebar = React.memo(EditorSidebarComponent);
