import {
  Menu,
  MenuItem,
  MenuHeading,
  Popover,
  ToggleButton,
  IconButton,
  Icon,
  SearchInput,
  SearchInputGroup,
} from '../ui';
import React from 'react';
import { EditorBatchActionBar } from './EditorBatchActionBar';
import { EditorDisplayControls } from './EditorDisplayControls';
import { EditorSelectionActions, type EditorSelectionActionsProps } from './EditorSelectionActions';
import {
  FILTER_MATCH_MODE_OPTIONS,
  FILTER_QUALITY_OPTIONS,
  FILTER_SORT_OPTIONS,
  FILTER_STATUS_OPTIONS,
} from '../../hooks/useEditorFilters';
import type { EditorStatusFilter, EditorTargetSearchScope } from '../editorFilterUtils';

interface EditorFilterBarProps {
  selectionActions?: EditorSelectionActionsProps;
  supportsBatchActions: boolean;
  customProject?: boolean;
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
  firstRepeatOnly: boolean;
  toggleFirstRepeatOnly: () => void;
  matchMode: 'contains' | 'exact' | 'regex';
  handleMatchModeChange: (value: 'contains' | 'exact' | 'regex') => void;
  statusFilters: EditorStatusFilter[];
  toggleStatusFilter: (value: EditorStatusFilter | 'all') => void;
  qualityFilters: Array<'qa_issue' | 'save_error'>;
  toggleQualityFilter: (value: 'all' | 'qa_issue' | 'save_error') => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
}

const EditorFilterBarComponent: React.FC<EditorFilterBarProps> = ({
  selectionActions,
  supportsBatchActions,
  customProject,
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
  firstRepeatOnly,
  toggleFirstRepeatOnly,
  matchMode,
  handleMatchModeChange,
  statusFilters,
  toggleStatusFilter,
  qualityFilters,
  toggleQualityFilter,
  clearFilters,
  hasActiveFilter,
}) => {
  const filterMenuRef = React.useRef<HTMLButtonElement>(null);
  const sortMenuRef = React.useRef<HTMLButtonElement>(null);
  const matchModeMenuRef = React.useRef<HTMLButtonElement>(null);
  const [isMatchModeMenuOpen, setMatchModeMenuOpen] = React.useState(false);
  const matchModeLabel = FILTER_MATCH_MODE_OPTIONS.find(
    (option) => option.value === matchMode,
  )?.label;
  return (
    <div className="sticky top-0 z-20 bg-surface-chrome border-b border-border-subtle">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-1.5">
        <EditorBatchActionBar
          visible={supportsBatchActions}
          custom={customProject}
          canRunActions={canRunActions}
          isBatchAITranslating={isBatchAITranslating}
          isBatchAIStopping={isBatchAIStopping}
          isBatchQARunning={isBatchQARunning}
          onOpenBatchAIModal={onOpenBatchAIModal}
          onCancelBatchAITranslate={onCancelBatchAITranslate}
          onRunBatchQA={onRunBatchQA}
        />
        {supportsBatchActions && (
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
        )}
        {selectionActions && <EditorSelectionActions {...selectionActions} />}
        {selectionActions && <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />}
        <EditorDisplayControls
          canRunActions={canRunActions}
          showNonPrintingSymbols={showNonPrintingSymbols}
          onToggleNonPrintingSymbols={onToggleNonPrintingSymbols}
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="relative shrink-0">
          <IconButton
            type="button"
            ref={sortMenuRef}
            variant="ghost"
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
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand-solid" />
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

        <SearchInputGroup label="Source and target filters" className="flex-1">
          <SearchInput
            ref={sourceSearchInputRef as React.RefObject<HTMLInputElement>}
            value={sourceQueryInput}
            onChange={(event) => setSourceQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            aria-label="Filter source text"
            placeholder="Filter source text"
          />

          <SearchInput
            ref={targetSearchInputRef as React.RefObject<HTMLInputElement>}
            value={targetQueryInput}
            onChange={(event) => setTargetQueryInput(event.target.value)}
            onFocus={onSearchInputFocus}
            onBlur={onSearchInputBlur}
            aria-label={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
            placeholder={targetSearchScope === 'context' ? 'Filter context' : 'Filter target text'}
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
        </SearchInputGroup>

        <div className="relative shrink-0">
          <IconButton
            ref={matchModeMenuRef}
            size="sm"
            variant="ghost"
            tone={isMatchModeMenuOpen || matchMode !== 'contains' ? 'brand' : 'neutral'}
            aria-label={`Search match mode: ${matchModeLabel}`}
            title={`Search match mode: ${matchModeLabel}`}
            aria-haspopup="menu"
            aria-expanded={isMatchModeMenuOpen}
            onClick={() => setMatchModeMenuOpen((open) => !open)}
          >
            <Icon name="settings-2" />
          </IconButton>
          {isMatchModeMenuOpen && (
            <Menu
              anchor={matchModeMenuRef}
              onClose={() => setMatchModeMenuOpen(false)}
              label="Search match mode"
              className="max-w-40"
            >
              {FILTER_MATCH_MODE_OPTIONS.map((option) => (
                <MenuItem
                  size="sm"
                  key={option.value}
                  selected={matchMode === option.value}
                  onClick={() => handleMatchModeChange(option.value)}
                >
                  {option.label}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>

        <div className="relative shrink-0">
          <IconButton
            type="button"
            ref={filterMenuRef}
            variant="ghost"
            onClick={toggleFilterMenu}
            tone={isFilterMenuOpen || activeFilterCount > 0 ? 'brand' : 'neutral'}
            aria-label="Open filters"
            aria-haspopup="dialog"
            aria-expanded={isFilterMenuOpen}
            title="Open filters"
          >
            <Icon name="funnel" />
          </IconButton>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 rounded-full bg-brand-solid px-1.5 py-0.5 text-reference-meta text-brand-contrast leading-none">
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
              <div role="group" aria-label="Status">
                <div className="text-caption font-bold uppercase tracking-wider text-text-faint mb-2">
                  Status
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_STATUS_OPTIONS.map((option) => (
                    <ToggleButton
                      pressed={
                        option.value === 'all'
                          ? statusFilters.length === 0
                          : statusFilters.includes(option.value)
                      }
                      size="xs"
                      key={option.value}
                      onClick={() => toggleStatusFilter(option.value)}
                    >
                      {option.label}
                    </ToggleButton>
                  ))}
                </div>
              </div>

              <div role="group" aria-label="QA">
                <div className="text-caption font-bold uppercase tracking-wider text-text-faint mb-2">
                  QA
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleButton
                    pressed={qualityFilters.length === 0}
                    size="xs"
                    onClick={() => toggleQualityFilter('all')}
                  >
                    All
                  </ToggleButton>
                  {FILTER_QUALITY_OPTIONS.map((option) => (
                    <ToggleButton
                      pressed={qualityFilters.includes(option.value)}
                      size="xs"
                      key={option.value}
                      onClick={() => toggleQualityFilter(option.value)}
                    >
                      {option.label}
                    </ToggleButton>
                  ))}
                </div>
              </div>

              <div role="group" aria-label="String">
                <div className="text-caption font-bold uppercase tracking-wider text-text-faint mb-2">
                  String
                </div>
                <ToggleButton pressed={firstRepeatOnly} size="xs" onClick={toggleFirstRepeatOnly}>
                  First repetition
                </ToggleButton>
              </div>
            </Popover>
          )}
        </div>

        <IconButton
          size="md"
          tone="neutral"
          variant="ghost"
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
