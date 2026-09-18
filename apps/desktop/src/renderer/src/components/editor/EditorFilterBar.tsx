import {
  Menu,
  MenuItem,
  MenuHeading,
  Popover,
  ToggleButton,
  IconButton,
  SearchInput,
  AppearancePicker,
} from '../ui';
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
  closeSortMenu: () => void;
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
  closeFilterMenu: () => void;
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
  closeSortMenu,
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
  closeFilterMenu,
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
    <div className="sticky top-0 z-20 bg-surface-chrome border-b border-border-subtle">
      <div className="flex items-center gap-1.5 px-4 py-1.5">
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
        {supportsBatchActions && (
          <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
        )}
        <AppearancePicker label="Editor appearance" />
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5">
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
              onClose={closeSortMenu}
              label="Sort"
              placement="bottom-start"
            >
              <MenuHeading>Sort</MenuHeading>
              {FILTER_SORT_OPTIONS.map((option) => {
                const active = sortBy === option.sortBy && sortDirection === option.sortDirection;
                return (
                  <MenuItem
                    size="sm"
                    selected={active}
                    key={`${option.sortBy}-${option.sortDirection}`}
                    type="button"
                    onClick={() => handleSortChange(option.sortBy, option.sortDirection)}
                  >
                    {option.label}
                  </MenuItem>
                );
              })}
            </Menu>
          )}
        </div>

        <SearchInput
          ref={sourceSearchInputRef as React.RefObject<HTMLInputElement>}
          value={sourceQueryInput}
          onChange={(event) => setSourceQueryInput(event.target.value)}
          onFocus={onSearchInputFocus}
          onBlur={onSearchInputBlur}
          placeholder="Filter source text"
          className="flex-1"
        />

        <SearchInput
          ref={targetSearchInputRef as React.RefObject<HTMLInputElement>}
          value={targetQueryInput}
          onChange={(event) => setTargetQueryInput(event.target.value)}
          onFocus={onSearchInputFocus}
          onBlur={onSearchInputBlur}
          aria-label={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
          placeholder={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
          className="flex-1"
          trailingAction={
            <IconButton
              variant="ghost"
              tone="brand"
              size="xs"
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
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M8 7h11m0 0-4-4m4 4-4 4M16 17H5m0 0 4 4m-4-4 4-4"
                />
              </svg>
            </IconButton>
          }
        />

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
            <span className="absolute -top-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] text-brand-contrast leading-none">
              {activeFilterCount}
            </span>
          )}

          {isFilterMenuOpen && (
            <Popover
              anchor={filterMenuRef}
              onClose={closeFilterMenu}
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
                        size="xs"
                        key={preset.value}
                        type="button"
                        onClick={() => applyQuickPreset(preset.value)}
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
                        size="xs"
                        key={mode.value}
                        type="button"
                        onClick={() => handleMatchModeChange(mode.value)}
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
                        size="xs"
                        key={option.value}
                        type="button"
                        onClick={() => handleStatusFilterChange(option.value)}
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
                        size="xs"
                        key={option.value}
                        type="button"
                        onClick={() => toggleQualityFilter(option.value)}
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

        <IconButton
          size="md"
          tone="neutral"
          variant="outline"
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilter}
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
        </IconButton>
      </div>
    </div>
  );
};

export const EditorFilterBar = React.memo(EditorFilterBarComponent);
