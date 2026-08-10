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
  buildSearchableEditorSegmentsIncrementally,
  buildSearchableEditorSegmentsWithWeakCache,
  createEditorSearchableListCache,
  resolveActiveFilteredSegmentIndex,
  resolveActiveSegmentIdForFilteredList,
} from './editor/editorSearchableSegments';
import { useEditorFilterMenus } from './editor/useEditorFilterMenus';
import type { SegmentChangeHint } from './editor/editorSegmentState';

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
  { value: 'first_repeat', label: '首次重复' },
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
  segmentChangeHint?: SegmentChangeHint;
  segmentIndexById?: ReadonlyMap<string, number>;
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
  buildSearchableEditorSegmentsIncrementally,
  buildSearchableEditorSegmentsWithWeakCache,
  createEditorSearchableListCache,
  resolveActiveFilteredSegmentIndex,
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

export function canReuseEditorSegmentListWithoutRefreshingSearchText(
  criteria: EditorFilterCriteria,
): boolean {
  return (
    criteria.status === 'all' &&
    criteria.qualityFilters.length === 0 &&
    criteria.quickPreset === 'none' &&
    criteria.sourceQuery.trim().length === 0 &&
    criteria.targetQuery.trim().length === 0 &&
    criteria.sortBy === 'default'
  );
}

export interface EditorFilterSnapshotCache {
  resolve(params: {
    scopeKey: string | number;
    segments: SearchableEditorSegment[];
    criteria: EditorFilterCriteria;
    refreshToken?: number;
  }): SearchableEditorSegment[];
}

function buildEditorFilterSnapshotKey(
  scopeKey: string | number,
  criteria: EditorFilterCriteria,
): string {
  return JSON.stringify([
    scopeKey,
    criteria.sourceQuery,
    criteria.targetQuery,
    criteria.status,
    criteria.matchMode,
    criteria.qualityFilters,
    criteria.quickPreset,
    criteria.sortBy,
    criteria.sortDirection,
  ]);
}

export function createEditorFilterSnapshotCache(): EditorFilterSnapshotCache {
  let snapshotKey: string | null = null;
  let snapshotIds: string[] = [];
  let lastRefreshToken: number | undefined;

  return {
    resolve: ({ scopeKey, segments, criteria, refreshToken }) => {
      if (canReuseEditorSegmentListWithoutRefreshingSearchText(criteria)) {
        snapshotKey = null;
        snapshotIds = [];
        lastRefreshToken = refreshToken;
        return segments;
      }

      const nextSnapshotKey = buildEditorFilterSnapshotKey(scopeKey, criteria);
      const shouldRefresh =
        snapshotKey !== nextSnapshotKey ||
        (refreshToken !== undefined && refreshToken !== lastRefreshToken);

      if (shouldRefresh) {
        snapshotKey = nextSnapshotKey;
        lastRefreshToken = refreshToken;
        const matches = filterSearchableSegments(segments, criteria);
        const sorted = sortSearchableSegments(matches, criteria.sortBy, criteria.sortDirection);
        snapshotIds = sorted.map((item) => item.segment.segmentId);
        return sorted;
      }

      const currentById = new Map(segments.map((item) => [item.segment.segmentId, item]));
      const currentSnapshot = snapshotIds.flatMap((segmentId) => {
        const item = currentById.get(segmentId);
        return item ? [item] : [];
      });
      if (currentSnapshot.length !== snapshotIds.length) {
        snapshotIds = currentSnapshot.map((item) => item.segment.segmentId);
      }
      return currentSnapshot;
    },
  };
}

export function useEditorFilters({
  fileId,
  segments,
  segmentChangeHint,
  segmentIndexById,
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
  const searchableListCache = useMemo(() => createEditorSearchableListCache(), []);
  const filterSnapshotCache = useMemo(() => createEditorFilterSnapshotCache(), []);

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

  const effectiveCriteria = useMemo(
    () => ({
      ...filterState,
      sourceQuery: debouncedSourceQuery,
      targetQuery: debouncedTargetQuery,
    }),
    [filterState, debouncedSourceQuery, debouncedTargetQuery],
  );
  const canReuseSearchableList =
    canReuseEditorSegmentListWithoutRefreshingSearchText(effectiveCriteria);

  const searchableSegments = useMemo(() => {
    return searchableListCache.resolve({
      segments,
      segmentSaveErrors,
      changedSegmentIds: segmentChangeHint?.changedSegmentIds,
      segmentIndexById,
      orderChanged: segmentChangeHint?.orderChanged ?? true,
      contentIndependent: canReuseSearchableList,
    });
  }, [
    canReuseSearchableList,
    searchableListCache,
    segments,
    segmentChangeHint,
    segmentIndexById,
    segmentSaveErrors,
  ]);

  const filteredSegments = useMemo(
    () =>
      filterSnapshotCache.resolve({
        scopeKey: fileId,
        segments: searchableSegments,
        criteria: effectiveCriteria,
        refreshToken: segmentChangeHint?.orderChanged ? segmentChangeHint.revision : undefined,
      }),
    [effectiveCriteria, fileId, filterSnapshotCache, searchableSegments, segmentChangeHint],
  );

  const activeFilterCount = countActiveFilterFields(filterState);
  const hasActiveFilter = activeFilterCount > 0 || filterState.sortBy !== 'default';
  const activeFilteredIndex = useMemo(
    () =>
      resolveActiveFilteredSegmentIndex({
        activeSegmentId,
        filteredSegments,
        segmentIndexById,
        canUseSegmentIndex: !hasActiveFilter,
      }),
    [activeSegmentId, filteredSegments, hasActiveFilter, segmentIndexById],
  );

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
      segmentIndexById,
    });
    if (!nextActiveSegmentId) return;
    if (nextActiveSegmentId === activeSegmentId) return;
    setActiveSegmentId(nextActiveSegmentId);
  }, [activeSegmentId, filteredSegments, segmentIndexById, segments, setActiveSegmentId]);

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
    activeFilteredIndex,
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
