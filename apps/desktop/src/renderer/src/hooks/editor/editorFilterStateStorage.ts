import {
  EditorFilterCriteria,
  EditorMatchMode,
  EditorQualityFilter,
  EditorSortBy,
  EditorSortDirection,
  EditorStatusFilter,
  EditorTargetSearchScope,
  createDefaultEditorFilterCriteria,
} from '../../components/editorFilterUtils';

const FILTER_STATE_STORAGE_KEY_PREFIX = 'editor-filter-state:v1:file:';

export type PersistedFilterShape = EditorFilterCriteria;

interface FilterStateGuards {
  statusValues: Set<EditorStatusFilter>;
  matchModeValues: Set<EditorMatchMode>;
  qualityValues: Set<EditorQualityFilter>;
  sortByValues: Set<EditorSortBy>;
  sortDirectionValues: Set<EditorSortDirection>;
  targetSearchScopeValues: Set<EditorTargetSearchScope>;
}

export function buildEditorFilterStorageKey(fileId: number): string {
  return `${FILTER_STATE_STORAGE_KEY_PREFIX}${fileId}`;
}

export function sanitizePersistedEditorFilterState(params: {
  raw: unknown;
  guards: FilterStateGuards;
}): EditorFilterCriteria {
  const defaults = createDefaultEditorFilterCriteria();
  if (!params.raw || typeof params.raw !== 'object') {
    return defaults;
  }

  const { guards } = params;
  const parsed = params.raw as Partial<PersistedFilterShape> & {
    status?: string;
    quickPreset?: string;
  };
  const sourceQuery =
    typeof parsed.sourceQuery === 'string' ? parsed.sourceQuery : defaults.sourceQuery;
  const targetQuery =
    typeof parsed.targetQuery === 'string' ? parsed.targetQuery : defaults.targetQuery;
  const targetSearchScope = guards.targetSearchScopeValues.has(
    parsed.targetSearchScope as EditorTargetSearchScope,
  )
    ? (parsed.targetSearchScope as EditorTargetSearchScope)
    : defaults.targetSearchScope;
  const legacyStatuses =
    parsed.quickPreset === 'unconfirmed'
      ? ['empty', 'draft']
      : parsed.quickPreset === 'confirmed'
        ? ['confirmed']
        : [parsed.status];
  const statuses = [
    ...new Set(
      (Array.isArray(parsed.statuses) ? parsed.statuses : legacyStatuses)
        .map((value) =>
          value === 'new'
            ? 'empty'
            : value === 'translated' || value === 'reviewed'
              ? 'draft'
              : value,
        )
        .filter((value): value is EditorStatusFilter =>
          guards.statusValues.has(value as EditorStatusFilter),
        ),
    ),
  ];
  const matchMode = guards.matchModeValues.has(parsed.matchMode as EditorMatchMode)
    ? (parsed.matchMode as EditorMatchMode)
    : defaults.matchMode;
  const qualityFilters = Array.isArray(parsed.qualityFilters)
    ? parsed.qualityFilters.filter((value): value is EditorQualityFilter =>
        guards.qualityValues.has(value as EditorQualityFilter),
      )
    : defaults.qualityFilters;
  if (parsed.quickPreset === 'issues' && qualityFilters.length === 0) {
    qualityFilters.push(...guards.qualityValues);
  }
  const sortBy = guards.sortByValues.has(parsed.sortBy as EditorSortBy)
    ? (parsed.sortBy as EditorSortBy)
    : defaults.sortBy;
  const sortDirection = guards.sortDirectionValues.has(parsed.sortDirection as EditorSortDirection)
    ? (parsed.sortDirection as EditorSortDirection)
    : defaults.sortDirection;

  return {
    sourceQuery,
    targetQuery,
    targetSearchScope,
    statuses,
    matchMode,
    qualityFilters,
    firstRepeatOnly: parsed.firstRepeatOnly === true || parsed.quickPreset === 'first_repeat',
    sortBy,
    sortDirection,
  };
}

export function loadPersistedFilterState(params: {
  fileId: number;
  sanitize: (raw: unknown) => EditorFilterCriteria;
  onError: (error: unknown) => void;
}): EditorFilterCriteria {
  const defaults = createDefaultEditorFilterCriteria();
  const storageKey = buildEditorFilterStorageKey(params.fileId);

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return params.sanitize(JSON.parse(raw) as unknown);
  } catch (error) {
    params.onError(error);
    return defaults;
  }
}

export function persistFilterState(params: {
  fileId: number;
  filterState: EditorFilterCriteria;
  onError: (error: unknown) => void;
}): void {
  const storageKey = buildEditorFilterStorageKey(params.fileId);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(params.filterState));
  } catch (error) {
    params.onError(error);
  }
}
