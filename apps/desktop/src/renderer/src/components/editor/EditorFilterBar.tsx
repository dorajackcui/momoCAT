import React from 'react';
import { EditorBatchActionBar } from './EditorBatchActionBar';
import {
  FILTER_MATCH_MODE_OPTIONS,
  FILTER_QUALITY_OPTIONS,
  FILTER_QUICK_PRESET_OPTIONS,
  FILTER_SORT_OPTIONS,
  FILTER_STATUS_OPTIONS,
} from '../../hooks/useEditorFilters';

interface EditorFilterBarProps {
  supportsBatchActions: boolean;
  canRunActions: boolean;
  isBatchAITranslating: boolean;
  isBatchQARunning: boolean;
  showNonPrintingSymbols: boolean;
  onOpenBatchAIModal: () => void;
  onRunBatchQA: () => void;
  onToggleNonPrintingSymbols: () => void;
  sortBy: string;
  sortDirection: string;
  isSortMenuOpen: boolean;
  toggleSortMenu: () => void;
  handleSortChange: (sortBy: 'default' | 'source_length' | 'target_length', direction: 'asc' | 'desc') => void;
  sourceQueryInput: string;
  targetQueryInput: string;
  setSourceQueryInput: (value: string) => void;
  setTargetQueryInput: (value: string) => void;
  sourceSearchInputRef: React.RefObject<HTMLInputElement | null>;
  targetSearchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchInputFocus: () => void;
  onSearchInputBlur: () => void;
  isFilterMenuOpen: boolean;
  activeFilterCount: number;
  toggleFilterMenu: () => void;
  quickPreset: string;
  applyQuickPreset: (value: 'none' | 'untranslated' | 'confirmed' | 'issues') => void;
  matchMode: 'contains' | 'exact' | 'regex';
  handleMatchModeChange: (value: 'contains' | 'exact' | 'regex') => void;
  statusFilter: 'all' | 'new' | 'draft' | 'translated' | 'reviewed' | 'confirmed';
  handleStatusFilterChange: (value: 'all' | 'new' | 'draft' | 'translated' | 'reviewed' | 'confirmed') => void;
  qualityFilters: Array<'qa_error' | 'qa_warning' | 'save_error'>;
  toggleQualityFilter: (value: 'qa_error' | 'qa_warning' | 'save_error') => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
  filterMenuRef: React.RefObject<HTMLDivElement | null>;
  sortMenuRef: React.RefObject<HTMLDivElement | null>;
}

const EditorFilterBarComponent: React.FC<EditorFilterBarProps> = ({
  supportsBatchActions,
  canRunActions,
  isBatchAITranslating,
  isBatchQARunning,
  showNonPrintingSymbols,
  onOpenBatchAIModal,
  onRunBatchQA,
  onToggleNonPrintingSymbols,
  sortBy,
  sortDirection,
  isSortMenuOpen,
  toggleSortMenu,
  handleSortChange,
  sourceQueryInput,
  targetQueryInput,
  setSourceQueryInput,
  setTargetQueryInput,
  sourceSearchInputRef,
  targetSearchInputRef,
  onSearchInputFocus,
  onSearchInputBlur,
  isFilterMenuOpen,
  activeFilterCount,
  toggleFilterMenu,
  quickPreset,
  applyQuickPreset,
  matchMode,
  handleMatchModeChange,
  statusFilter,
  handleStatusFilterChange,
  qualityFilters,
  toggleQualityFilter,
  clearFilters,
  hasActiveFilter,
  filterMenuRef,
  sortMenuRef,
}) => {
  return (
    <div className="sticky top-0 z-20 bg-surface border-b border-border shadow-sm">
      <EditorBatchActionBar
        visible={supportsBatchActions}
        canRunActions={canRunActions}
        isBatchAITranslating={isBatchAITranslating}
        isBatchQARunning={isBatchQARunning}
        showNonPrintingSymbols={showNonPrintingSymbols}
        onOpenBatchAIModal={onOpenBatchAIModal}
        onRunBatchQA={onRunBatchQA}
        onToggleNonPrintingSymbols={onToggleNonPrintingSymbols}
      />

      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/80 backdrop-blur-sm">
        <div ref={sortMenuRef as React.RefObject<HTMLDivElement>} className="relative shrink-0">
          <button
            type="button"
            onClick={toggleSortMenu}
            className={`h-8 w-8 rounded-md border transition-colors ${
              isSortMenuOpen || sortBy !== 'default'
                ? 'bg-brand-soft text-brand border-brand/30'
                : 'bg-surface text-text-muted border-border hover:bg-muted'
            }`}
            title="Sort options"
            aria-label="Sort options"
          >
            <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M6 12h12M10 17h4" />
            </svg>
          </button>

          {sortBy !== 'default' && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand" />
          )}

          {isSortMenuOpen && (
            <div className="absolute left-0 top-full mt-2 w-64 rounded-lg border border-border bg-surface shadow-lg p-2 z-30 space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-faint">Sort</div>
              {FILTER_SORT_OPTIONS.map((option) => {
                const active = sortBy === option.sortBy && sortDirection === option.sortDirection;
                return (
                  <button
                    key={`${option.sortBy}-${option.sortDirection}`}
                    type="button"
                    onClick={() => handleSortChange(option.sortBy, option.sortDirection)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
                      active
                        ? 'bg-brand-soft text-brand border-brand/30'
                        : 'bg-surface text-text-muted border-transparent hover:text-text-muted hover:bg-muted'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <label className="relative flex-1 min-w-0">
          <input
            ref={sourceSearchInputRef as React.RefObject<HTMLInputElement>}
            value={sourceQueryInput}
            onChange={(event) => setSourceQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            placeholder="Filter source text"
            className="w-full rounded-xl border border-border bg-surface pl-8 pr-3 py-1.5 text-sm text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
        </label>

        <label className="relative flex-1 min-w-0">
          <input
            ref={targetSearchInputRef as React.RefObject<HTMLInputElement>}
            value={targetQueryInput}
            onChange={(event) => setTargetQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            placeholder="Filter target text"
            className="w-full rounded-xl border border-border bg-surface pl-8 pr-3 py-1.5 text-sm text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
        </label>

        <div ref={filterMenuRef as React.RefObject<HTMLDivElement>} className="relative shrink-0">
          <button
            type="button"
            onClick={toggleFilterMenu}
            className={`h-8 w-8 rounded-md border transition-colors ${
              isFilterMenuOpen || activeFilterCount > 0
                ? 'bg-brand-soft text-brand border-brand/30'
                : 'bg-surface text-text-muted border-border hover:bg-muted'
            }`}
            aria-label="Open filters"
            title="Open filters"
          >
            <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 12h12M10 20h4" />
            </svg>
          </button>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] text-white leading-none">
              {activeFilterCount}
            </span>
          )}

          {isFilterMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border bg-surface shadow-lg p-3 z-30 space-y-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">Quick Presets</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_QUICK_PRESET_OPTIONS.map((preset) => {
                    const active = quickPreset === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => applyQuickPreset(preset.value)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                          active
                            ? 'bg-brand-soft text-brand border-brand/30'
                            : 'bg-surface text-text-muted border-border hover:text-text-muted hover:bg-muted'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">Match Mode</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_MATCH_MODE_OPTIONS.map((mode) => {
                    const active = matchMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => handleMatchModeChange(mode.value)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                          active
                            ? 'bg-brand-soft text-brand border-brand/30'
                            : 'bg-surface text-text-muted border-border hover:text-text-muted hover:bg-muted'
                        }`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_STATUS_OPTIONS.map((option) => {
                    const active = statusFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleStatusFilterChange(option.value)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                          active
                            ? 'bg-brand-soft text-brand border-brand/30'
                            : 'bg-surface text-text-muted border-border hover:text-text-muted hover:bg-muted'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">Quality</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_QUALITY_OPTIONS.map((option) => {
                    const active = qualityFilters.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => toggleQualityFilter(option.value)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                          active
                            ? 'bg-brand-soft text-brand border-brand/30'
                            : 'bg-surface text-text-muted border-border hover:text-text-muted hover:bg-muted'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilter}
          className="h-8 w-8 shrink-0 rounded-md border border-border bg-surface text-text-muted hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Clear filter"
          title="Clear filter"
        >
          <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export const EditorFilterBar = React.memo(EditorFilterBarComponent);
