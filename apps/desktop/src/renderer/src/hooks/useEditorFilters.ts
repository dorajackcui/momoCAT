import type { QaHighlightSelection } from '../components/qaHighlights';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  EditorFilterCriteria,
  EditorMatchMode,
  EditorQualityFilter,
  EditorSortBy,
  EditorSortDirection,
  EditorStatusFilter,
  EditorTargetSearchScope,
  countActiveFilterFields,
  createDefaultEditorFilterCriteria,
  toggleFilterSelection,
} from '../components/editorFilterUtils';
import {
  buildEditorFilterStorageKey as buildEditorFilterStorageKeyInternal,
  loadPersistedFilterState,
  persistFilterState,
  sanitizePersistedEditorFilterState as sanitizePersistedEditorFilterStateInternal,
} from './editor/editorFilterStateStorage';
import { createEditorView } from './editor/editorView';
import type { EditorSegmentStore } from './editor/editorSegmentStore';
import { useEditorFilterMenus } from './editor/useEditorFilterMenus';

const SEARCH_DEBOUNCE_MS = 120;

export const FILTER_STATUS_OPTIONS: Array<{ value: EditorStatusFilter | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'empty', label: 'Empty' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
];

export const FILTER_MATCH_MODE_OPTIONS: Array<{ value: EditorMatchMode; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'exact', label: 'Exact' },
  { value: 'regex', label: 'Regex' },
];

export const FILTER_QUALITY_OPTIONS: Array<{ value: EditorQualityFilter; label: string }> = [
  { value: 'qa_issue', label: 'QA problems' },
  { value: 'save_error', label: 'Save error' },
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
  segmentStore: EditorSegmentStore;
  segmentSaveErrors: Record<string, string>;
  activeSegmentId: string | null;
  setActiveSegmentId: (segmentId: string) => void;
}

const STATUS_VALUES = new Set(
  FILTER_STATUS_OPTIONS.map((item) => item.value).filter((value) => value !== 'all'),
);
const MATCH_MODE_VALUES = new Set(FILTER_MATCH_MODE_OPTIONS.map((item) => item.value));
const QUALITY_VALUES = new Set(FILTER_QUALITY_OPTIONS.map((item) => item.value));
const SORT_BY_VALUES = new Set<EditorSortBy>(['default', 'source_length', 'target_length']);
const SORT_DIRECTION_VALUES = new Set<EditorSortDirection>(['asc', 'desc']);
const TARGET_SEARCH_SCOPE_VALUES = new Set<EditorTargetSearchScope>(['target', 'context']);

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
      sortByValues: SORT_BY_VALUES,
      sortDirectionValues: SORT_DIRECTION_VALUES,
      targetSearchScopeValues: TARGET_SEARCH_SCOPE_VALUES,
    },
  });
}

export function useEditorFilters({
  fileId,
  segmentStore,
  segmentSaveErrors,
  activeSegmentId,
  setActiveSegmentId,
}: UseEditorFiltersParams) {
  const [qaSelection, setQASelection] = useState<{
    fileId: number;
    ids: string[];
    label: string;
    highlightSelection?: QaHighlightSelection;
  } | null>(null);
  const qaFilter = qaSelection?.fileId === fileId ? qaSelection : null;
  const [filterState, setFilterState] = useState<EditorFilterCriteria>(
    createDefaultEditorFilterCriteria,
  );
  const [debouncedSourceQuery, setDebouncedSourceQuery] = useState('');
  const [debouncedTargetQuery, setDebouncedTargetQuery] = useState('');
  const filterStateHydratedRef = useRef(false);
  const projection = useMemo(() => createEditorView(), [segmentStore]);
  const orderIds = useSyncExternalStore(segmentStore.subscribe, segmentStore.getOrderIds);

  const menus = useEditorFilterMenus();
  const {
    isFilterMenuOpen,
    isSortMenuOpen,
    toggleFilterMenu,
    toggleSortMenu,
    closeFilterMenu,
    closeSortMenu,
    closeMenus,
  } = menus;

  const effectiveCriteria = useMemo(
    () => ({
      ...filterState,
      sourceQuery: debouncedSourceQuery,
      targetQuery: debouncedTargetQuery,
    }),
    [filterState, debouncedSourceQuery, debouncedTargetQuery],
  );
  const view = projection.resolve({
    store: segmentStore,
    criteria: effectiveCriteria,
    qaIds: qaFilter?.ids,
    saveErrors: segmentSaveErrors,
  });
  const activeFilterCount = countActiveFilterFields(filterState) + Number(Boolean(qaFilter));
  const hasActiveFilter = activeFilterCount > 0 || filterState.sortBy !== 'default';
  const activeFilteredIndex = activeSegmentId ? (view.indexById.get(activeSegmentId) ?? -1) : -1;

  const clearFilters = useCallback(() => {
    setQASelection(null);
    const defaults = createDefaultEditorFilterCriteria();
    setFilterState(defaults);
    setDebouncedSourceQuery(defaults.sourceQuery);
    setDebouncedTargetQuery(defaults.targetQuery);
    closeMenus();
  }, [closeMenus]);
  const applyQAFilter = useCallback(
    (ids: string[], label: string, highlightSelection?: QaHighlightSelection) => {
      clearFilters();
      setQASelection({ fileId, ids: [...new Set(ids)], label, highlightSelection });
    },
    [clearFilters, fileId],
  );

  const setSourceQueryInput = useCallback((value: string) => {
    setFilterState((prev) => ({ ...prev, sourceQuery: value }));
  }, []);

  const setTargetQueryInput = useCallback((value: string) => {
    setFilterState((prev) => ({ ...prev, targetQuery: value }));
  }, []);

  const toggleTargetSearchScope = useCallback(() => {
    setFilterState((prev) => ({
      ...prev,
      targetSearchScope: prev.targetSearchScope === 'target' ? 'context' : 'target',
    }));
  }, []);

  const toggleStatusFilter = useCallback((status: EditorStatusFilter | 'all') => {
    setFilterState((prev) => ({
      ...prev,
      statuses: toggleFilterSelection(prev.statuses, status),
    }));
  }, []);

  const toggleFirstRepeatOnly = useCallback(() => {
    setFilterState((prev) => ({ ...prev, firstRepeatOnly: !prev.firstRepeatOnly }));
  }, []);

  const handleMatchModeChange = useCallback((nextMode: EditorMatchMode) => {
    setFilterState((prev) => ({
      ...prev,
      matchMode: nextMode,
    }));
  }, []);

  const toggleQualityFilter = useCallback((quality: EditorQualityFilter | 'all') => {
    setFilterState((prev) => ({
      ...prev,
      qualityFilters: toggleFilterSelection(prev.qualityFilters, quality),
    }));
  }, []);

  const handleSortChange = useCallback(
    (sortBy: EditorSortBy, sortDirection: EditorSortDirection) => {
      setFilterState((prev) => ({
        ...prev,
        sortBy,
        sortDirection,
      }));
      closeSortMenu();
    },
    [closeSortMenu],
  );

  useEffect(() => {
    filterStateHydratedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- QA selection belongs to the file being left.
    setQASelection(null);

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
    if (view.ids.length && (!activeSegmentId || !segmentStore.getSegment(activeSegmentId))) {
      setActiveSegmentId(view.ids[0]);
    }
  }, [activeSegmentId, view.ids, orderIds, segmentStore, setActiveSegmentId]);

  // Batch operations can resolve input that has not reached the debounced display yet.
  const getFilteredSegmentIds = useCallback((): string[] | null => {
    if (activeFilterCount === 0) return null;
    if (
      filterState.sourceQuery === debouncedSourceQuery &&
      filterState.targetQuery === debouncedTargetQuery
    )
      return [...view.ids];
    return projection.searchIds({
      store: segmentStore,
      criteria: filterState,
      qaIds: qaFilter?.ids,
      saveErrors: segmentSaveErrors,
    });
  }, [
    activeFilterCount,
    debouncedSourceQuery,
    debouncedTargetQuery,
    view.ids,
    filterState,
    projection,
    segmentStore,
    qaFilter,
    segmentSaveErrors,
  ]);

  return {
    qaFilter,
    applyQAFilter,
    getFilteredSegmentIds,
    sourceQueryInput: filterState.sourceQuery,
    targetQueryInput: filterState.targetQuery,
    targetSearchScope: filterState.targetSearchScope,
    matchMode: filterState.matchMode,
    statusFilters: filterState.statuses,
    qualityFilters: filterState.qualityFilters,
    firstRepeatOnly: filterState.firstRepeatOnly,
    toggleFirstRepeatOnly,
    sortBy: filterState.sortBy,
    sortDirection: filterState.sortDirection,
    isFilterMenuOpen,
    isSortMenuOpen,
    visibleRows: view.rows,
    visibleIds: view.ids,
    activeFilteredIndex,
    activeFilterCount,
    hasActiveFilter,
    toggleFilterMenu,
    toggleSortMenu,
    closeFilterMenu,
    closeSortMenu,
    setSourceQueryInput,
    setTargetQueryInput,
    toggleTargetSearchScope,
    toggleStatusFilter,
    handleMatchModeChange,
    toggleQualityFilter,
    handleSortChange,
    clearFilters,
    debouncedSourceQuery,
    debouncedTargetQuery,
  };
}
