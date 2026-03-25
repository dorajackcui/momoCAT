import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@cat/core/models';
import {
  EditorFilterCriteria,
  EditorMatchMode,
  EditorQualityFilter,
  EditorQuickPreset,
  SearchableEditorSegment,
  EditorSortBy,
  EditorSortDirection,
  EditorStatusFilter,
  countActiveFilterFields,
  createDefaultEditorFilterCriteria,
  filterSearchableSegments,
  getQuickPresetPatch,
  sortSearchableSegments,
} from '../components/editorFilterUtils';
import {
  buildEditorFilterStorageKey as buildEditorFilterStorageKeyInternal,
  loadPersistedFilterState,
  persistFilterState,
  sanitizePersistedEditorFilterState as sanitizePersistedEditorFilterStateInternal,
} from './editor/editorFilterStateStorage';
import {
  buildSearchableEditorSegments,
  buildSearchableEditorSegmentsWithWeakCache,
  resolveActiveSegmentIdForFilteredList,
} from './editor/editorSearchableSegments';
import { useEditorFilterMenus } from './editor/useEditorFilterMenus';

const SEARCH_DEBOUNCE_MS = 120;

export const FILTER_STATUS_OPTIONS: Array<{ value: EditorStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'draft', label: 'Draft' },
  { value: 'translated', label: 'AI Translated' },
  { value: 'reviewed', label: 'AI Reviewed' },
  { value: 'confirmed', label: 'Confirmed' },
];

export const FILTER_MATCH_MODE_OPTIONS: Array<{ value: EditorMatchMode; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'exact', label: 'Exact' },
  { value: 'regex', label: 'Regex' },
];

export const FILTER_QUALITY_OPTIONS: Array<{ value: EditorQualityFilter; label: string }> = [
  { value: 'qa_error', label: 'QA error' },
  { value: 'qa_warning', label: 'QA warning' },
  { value: 'save_error', label: 'Save error' },
];

export const FILTER_QUICK_PRESET_OPTIONS: Array<{ value: EditorQuickPreset; label: string }> = [
  { value: 'untranslated', label: '未翻译' },
  { value: 'confirmed', label: '已确认' },
  { value: 'issues', label: '有问题段' },
];

export const FILTER_SORT_OPTIONS: Array<{
  sortBy: EditorSortBy;
  sortDirection: EditorSortDirection;
  label: string;
}> = [
  { sortBy: 'default', sortDirection: 'asc', label: 'Default order' },
  { sortBy: 'source_length', sortDirection: 'asc', label: 'Source length: short to long' },
  { sortBy: 'source_length', sortDirection: 'desc', label: 'Source length: long to short' },
  { sortBy: 'target_length', sortDirection: 'asc', label: 'Target length: short to long' },
  { sortBy: 'target_length', sortDirection: 'desc', label: 'Target length: long to short' },
];

export interface UseEditorFiltersParams {
  fileId: number;
  segments: Segment[];
  segmentSaveErrors: Record<string, string>;
  activeSegmentId: string | null;
  setActiveSegmentId: (segmentId: string) => void;
}

const STATUS_VALUES = new Set(FILTER_STATUS_OPTIONS.map((item) => item.value));
const MATCH_MODE_VALUES = new Set(FILTER_MATCH_MODE_OPTIONS.map((item) => item.value));
const QUALITY_VALUES = new Set(FILTER_QUALITY_OPTIONS.map((item) => item.value));
const QUICK_PRESET_VALUES = new Set(FILTER_QUICK_PRESET_OPTIONS.map((item) => item.value));
const SORT_BY_VALUES = new Set<EditorSortBy>(['default', 'source_length', 'target_length']);
const SORT_DIRECTION_VALUES = new Set<EditorSortDirection>(['asc', 'desc']);

export {
  buildSearchableEditorSegments,
  buildSearchableEditorSegmentsWithWeakCache,
  resolveActiveSegmentIdForFilteredList,
};

export function buildEditorFilterStorageKey(fileId: number): string {
  return buildEditorFilterStorageKeyInternal(fileId);
}

export function sanitizePersistedEditorFilterState(raw: unknown): EditorFilterCriteria {
  return sanitizePersistedEditorFilterStateInternal({
    raw,
    guards: {
      statusValues: STATUS_VALUES,
      matchModeValues: MATCH_MODE_VALUES,
      qualityValues: QUALITY_VALUES,
      quickPresetValues: QUICK_PRESET_VALUES,
      sortByValues: SORT_BY_VALUES,
      sortDirectionValues: SORT_DIRECTION_VALUES,
    },
  });
}

export function useEditorFilters({
  fileId,
  segments,
  segmentSaveErrors,
  activeSegmentId,
  setActiveSegmentId,
}: UseEditorFiltersParams) {
  const [filterState, setFilterState] = useState<EditorFilterCriteria>(
    createDefaultEditorFilterCriteria,
  );
  const [debouncedSourceQuery, setDebouncedSourceQuery] = useState('');
  const [debouncedTargetQuery, setDebouncedTargetQuery] = useState('');
  const filterStateHydratedRef = useRef(false);
  const searchableSegmentCache = useMemo<WeakMap<Segment, SearchableEditorSegment>>(
    () => new WeakMap(),
    [],
  );

  const menus = useEditorFilterMenus();
  const {
    isFilterMenuOpen,
    isSortMenuOpen,
    filterMenuRef,
    sortMenuRef,
    toggleFilterMenu,
    toggleSortMenu,
    closeMenus,
    setIsSortMenuOpen,
  } = menus;

  const searchableSegments = useMemo(
    () =>
      buildSearchableEditorSegmentsWithWeakCache({
        segments,
        segmentSaveErrors,
        cache: searchableSegmentCache,
      }),
    [searchableSegmentCache, segments, segmentSaveErrors],
  );

  const effectiveCriteria = useMemo(
    () => ({
      ...filterState,
      sourceQuery: debouncedSourceQuery,
      targetQuery: debouncedTargetQuery,
    }),
    [filterState, debouncedSourceQuery, debouncedTargetQuery],
  );

  const matchedSegments = useMemo(
    () => filterSearchableSegments(searchableSegments, effectiveCriteria),
    [searchableSegments, effectiveCriteria],
  );

  const filteredSegments = useMemo(
    () => sortSearchableSegments(matchedSegments, filterState.sortBy, filterState.sortDirection),
    [matchedSegments, filterState.sortBy, filterState.sortDirection],
  );

  const activeFilterCount = countActiveFilterFields(filterState);
  const hasActiveFilter = activeFilterCount > 0 || filterState.sortBy !== 'default';

  const clearFilters = useCallback(() => {
    const defaults = createDefaultEditorFilterCriteria();
    setFilterState(defaults);
    setDebouncedSourceQuery(defaults.sourceQuery);
    setDebouncedTargetQuery(defaults.targetQuery);
    closeMenus();
  }, [closeMenus]);

  const setSourceQueryInput = useCallback((value: string) => {
    setFilterState((prev) => ({ ...prev, sourceQuery: value }));
  }, []);

  const setTargetQueryInput = useCallback((value: string) => {
    setFilterState((prev) => ({ ...prev, targetQuery: value }));
  }, []);

  const handleStatusFilterChange = useCallback((nextStatus: EditorStatusFilter) => {
    setFilterState((prev) => ({
      ...prev,
      status: nextStatus,
      quickPreset: 'none',
    }));
  }, []);

  const handleMatchModeChange = useCallback((nextMode: EditorMatchMode) => {
    setFilterState((prev) => ({
      ...prev,
      matchMode: nextMode,
    }));
  }, []);

  const toggleQualityFilter = useCallback((quality: EditorQualityFilter) => {
    setFilterState((prev) => {
      const qualityFilters = prev.qualityFilters.includes(quality)
        ? prev.qualityFilters.filter((item) => item !== quality)
        : [...prev.qualityFilters, quality];
      return {
        ...prev,
        qualityFilters,
        quickPreset: 'none',
      };
    });
  }, []);

  const applyQuickPreset = useCallback((preset: EditorQuickPreset) => {
    const patch = getQuickPresetPatch(preset);
    setFilterState((prev) => ({
      ...prev,
      status: patch.status,
      qualityFilters: patch.qualityFilters,
      quickPreset: patch.quickPreset,
    }));
  }, []);

  const handleSortChange = useCallback(
    (sortBy: EditorSortBy, sortDirection: EditorSortDirection) => {
      setFilterState((prev) => ({
        ...prev,
        sortBy,
        sortDirection,
      }));
      setIsSortMenuOpen(false);
    },
    [setIsSortMenuOpen],
  );

  useEffect(() => {
    filterStateHydratedRef.current = false;

    const loadedState = loadPersistedFilterState({
      fileId,
      sanitize: sanitizePersistedEditorFilterState,
      onError: (error) => {
        console.warn('[useEditorFilters] Failed to hydrate filter state from localStorage', error);
      },
    });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate per-file state after file switch.
    setFilterState(loadedState);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep debounced state aligned with hydrated source query.
    setDebouncedSourceQuery(loadedState.sourceQuery);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep debounced state aligned with hydrated target query.
    setDebouncedTargetQuery(loadedState.targetQuery);
    filterStateHydratedRef.current = true;
    closeMenus();
  }, [closeMenus, fileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSourceQuery(filterState.sourceQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filterState.sourceQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTargetQuery(filterState.targetQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filterState.targetQuery]);

  useEffect(() => {
    if (!filterStateHydratedRef.current) return;
    persistFilterState({
      fileId,
      filterState,
      onError: (error) => {
        console.warn('[useEditorFilters] Failed to persist filter state to localStorage', error);
      },
    });
  }, [fileId, filterState]);

  useEffect(() => {
    const nextActiveSegmentId = resolveActiveSegmentIdForFilteredList({
      activeSegmentId,
      segments,
      filteredSegments,
    });
    if (!nextActiveSegmentId) return;
    if (nextActiveSegmentId === activeSegmentId) return;
    setActiveSegmentId(nextActiveSegmentId);
  }, [activeSegmentId, filteredSegments, segments, setActiveSegmentId]);

  return {
    sourceQueryInput: filterState.sourceQuery,
    targetQueryInput: filterState.targetQuery,
    matchMode: filterState.matchMode,
    statusFilter: filterState.status,
    qualityFilters: filterState.qualityFilters,
    quickPreset: filterState.quickPreset,
    sortBy: filterState.sortBy,
    sortDirection: filterState.sortDirection,
    isFilterMenuOpen,
    isSortMenuOpen,
    filterMenuRef,
    sortMenuRef,
    filteredSegments,
    activeFilterCount,
    hasActiveFilter,
    toggleFilterMenu,
    toggleSortMenu,
    setSourceQueryInput,
    setTargetQueryInput,
    handleStatusFilterChange,
    handleMatchModeChange,
    toggleQualityFilter,
    applyQuickPreset,
    handleSortChange,
    clearFilters,
    debouncedSourceQuery,
    debouncedTargetQuery,
  };
}
