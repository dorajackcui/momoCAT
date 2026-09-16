import { Menu, MenuItem, MenuHeading, Popover, ToggleButton, IconButton, Input } from '../ui';
import React from 'react';
import { EditorBatchActionBar } from './EditorBatchActionBar';
import {
  FILTER_MATCH_MODE_OPTIONS,
  FILTER_QUALITY_OPTIONS,
  FILTER_QUICK_PRESET_OPTIONS,
  FILTER_SORT_OPTIONS,
  FILTER_STATUS_OPTIONS,
} from '../../hooks/useEditorFilters';
import type { EditorQuickPreset, EditorTargetSearchScope } from '../editorFilterUtils';

interface EditorFilterBarProps {
  supportsBatchActions: boolean;
  canRunActions: boolean;
  isBatchAITranslating: boolean;
  isBatchAIStopping?: boolean;
  isBatchQARunning: boolean;
  showNonPrintingSymbols: boolean;
  onOpenBatchAIModal: () => void;
  onCancelBatchAITranslate: () => void;
  onRunBatchQA: () => void;
  onToggleNonPrintingSymbols: () => void;
  sortBy: string;
  sortDirection: string;
  isSortMenuOpen: boolean;
  toggleSortMenu: () => void;
  handleSortChange: (
    sortBy: 'default' | 'source_length' | 'target_length',
    direction: 'asc' | 'desc',
  ) => void;
  sourceQueryInput: string;
  targetQueryInput: string;
  setSourceQueryInput: (value: string) => void;
  setTargetQueryInput: (value: string) => void;
  targetSearchScope: EditorTargetSearchScope;
  toggleTargetSearchScope: () => void;
  sourceSearchInputRef: React.RefObject<HTMLInputElement | null>;
  targetSearchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchInputFocus: () => void;
  onSearchInputBlur: () => void;
  isFilterMenuOpen: boolean;
  activeFilterCount: number;
  toggleFilterMenu: () => void;
  quickPreset: EditorQuickPreset;
  applyQuickPreset: (value: EditorQuickPreset) => void;
  matchMode: 'contains' | 'exact' | 'regex';
  handleMatchModeChange: (value: 'contains' | 'exact' | 'regex') => void;
  statusFilter: 'all' | 'new' | 'draft' | 'translated' | 'reviewed' | 'confirmed';
  handleStatusFilterChange: (
    value: 'all' | 'new' | 'draft' | 'translated' | 'reviewed' | 'confirmed',
  ) => void;
  qualityFilters: Array<'qa_error' | 'qa_warning' | 'save_error'>;
  toggleQualityFilter: (value: 'qa_error' | 'qa_warning' | 'save_error') => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
}

const EditorFilterBarComponent: React.FC<EditorFilterBarProps> = ({
  supportsBatchActions,
  canRunActions,
  isBatchAITranslating,
  isBatchAIStopping,
  isBatchQARunning,
  showNonPrintingSymbols,
  onOpenBatchAIModal,
  onCancelBatchAITranslate,
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
  targetSearchScope,
  toggleTargetSearchScope,
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
}) => {
  const filterMenuRef = React.useRef<HTMLButtonElement>(null);
  const sortMenuRef = React.useRef<HTMLButtonElement>(null);
  return (
    <div className="sticky top-0 z-20 bg-surface border-b border-border">
      <EditorBatchActionBar
        visible={supportsBatchActions}
        canRunActions={canRunActions}
        isBatchAITranslating={isBatchAITranslating}
        isBatchAIStopping={isBatchAIStopping}
        isBatchQARunning={isBatchQARunning}
        showNonPrintingSymbols={showNonPrintingSymbols}
        onOpenBatchAIModal={onOpenBatchAIModal}
        onCancelBatchAITranslate={onCancelBatchAITranslate}
        onRunBatchQA={onRunBatchQA}
        onToggleNonPrintingSymbols={onToggleNonPrintingSymbols}
      />

      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface">
        <div className="relative shrink-0">
          <IconButton
            type="button"
            ref={sortMenuRef}
            onClick={toggleSortMenu}
            tone={isSortMenuOpen || sortBy !== 'default' ? 'brand' : 'neutral'}
            title="Sort options"
            aria-label="Sort options"
            aria-haspopup="menu"
            aria-expanded={isSortMenuOpen}
          >
            <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h8M6 12h12M10 17h4"
              />
            </svg>
          </IconButton>

          {sortBy !== 'default' && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand" />
          )}

          {isSortMenuOpen && (
            <Menu
              anchor={sortMenuRef}
              onClose={toggleSortMenu}
              label="Sort"
              placement="bottom-start"
            >
              <MenuHeading>Sort</MenuHeading>
              {FILTER_SORT_OPTIONS.map((option) => {
                const active = sortBy === option.sortBy && sortDirection === option.sortDirection;
                return (
                  <MenuItem
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
                  </MenuItem>
                );
              })}
            </Menu>
          )}
        </div>

        <label className="relative flex-1 min-w-0">
          <Input
            ref={sourceSearchInputRef as React.RefObject<HTMLInputElement>}
            value={sourceQueryInput}
            onChange={(event) => setSourceQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            placeholder="Filter source text"
            className="w-full rounded-xl border border-border bg-surface pl-8 pr-3 py-1.5 text-sm text-text-muted focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/15"
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

        <div className="relative flex-1 min-w-0">
          <Input
            ref={targetSearchInputRef as React.RefObject<HTMLInputElement>}
            value={targetQueryInput}
            onChange={(event) => setTargetQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            aria-label={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
            placeholder={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
            className="w-full rounded-xl border border-border bg-surface pl-8 pr-12 py-1.5 text-sm text-text-muted focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/15"
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
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              toggleTargetSearchScope();
              targetSearchInputRef.current?.focus();
            }}
            aria-pressed={targetSearchScope === 'context'}
            aria-label={
              targetSearchScope === 'context'
                ? 'Search context; switch to target text'
                : 'Search target text; switch to context'
            }
            title={
              targetSearchScope === 'context'
                ? 'Switch to target text search'
                : 'Switch to context search'
            }
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M8 7h11m0 0-4-4m4 4-4 4M16 17H5m0 0 4 4m-4-4 4-4"
              />
            </svg>
          </button>
        </div>

        <div className="relative shrink-0">
          <IconButton
            type="button"
            ref={filterMenuRef}
            onClick={toggleFilterMenu}
            tone={isFilterMenuOpen || activeFilterCount > 0 ? 'brand' : 'neutral'}
            aria-label="Open filters"
            aria-haspopup="dialog"
            aria-expanded={isFilterMenuOpen}
            title="Open filters"
          >
            <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4h18M6 12h12M10 20h4"
              />
            </svg>
          </IconButton>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] text-white leading-none">
              {activeFilterCount}
            </span>
          )}

          {isFilterMenuOpen && (
            <Popover
              anchor={filterMenuRef}
              onClose={toggleFilterMenu}
              label="Filters"
              className="w-80 space-y-3"
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">
                  Quick Presets
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_QUICK_PRESET_OPTIONS.map((preset) => {
                    const active = quickPreset === preset.value;
                    return (
                      <ToggleButton
                        pressed={active}
                        size="sm"
                        key={preset.value}
                        type="button"
                        onClick={() => applyQuickPreset(preset.value)}
                        className="!px-2.5 !py-1 text-[11px]"
                      >
                        {preset.label}
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">
                  Match Mode
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_MATCH_MODE_OPTIONS.map((mode) => {
                    const active = matchMode === mode.value;
                    return (
                      <ToggleButton
                        pressed={active}
                        size="sm"
                        key={mode.value}
                        type="button"
                        onClick={() => handleMatchModeChange(mode.value)}
                        className="!px-2.5 !py-1 text-[11px]"
                      >
                        {mode.label}
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">
                  Status
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_STATUS_OPTIONS.map((option) => {
                    const active = statusFilter === option.value;
                    return (
                      <ToggleButton
                        pressed={active}
                        size="sm"
                        key={option.value}
                        type="button"
                        onClick={() => handleStatusFilterChange(option.value)}
                        className="!px-2.5 !py-1 text-[11px]"
                      >
                        {option.label}
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint mb-2">
                  Quality
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_QUALITY_OPTIONS.map((option) => {
                    const active = qualityFilters.includes(option.value);
                    return (
                      <ToggleButton
                        pressed={active}
                        size="sm"
                        key={option.value}
                        type="button"
                        onClick={() => toggleQualityFilter(option.value)}
                        className="!px-2.5 !py-1 text-[11px]"
                      >
                        {option.label}
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>
            </Popover>
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
          <svg
            className="w-3.5 h-3.5 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export const EditorFilterBar = React.memo(EditorFilterBarComponent);
