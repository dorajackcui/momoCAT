import type { Segment } from '@cat/core/models';

export type EditorStatusFilter = 'all' | 'new' | 'draft' | 'translated' | 'reviewed' | 'confirmed';
export type EditorMatchMode = 'contains' | 'exact' | 'regex';
export type EditorQualityFilter = 'qa_error' | 'qa_warning' | 'save_error';
export type EditorQuickPreset = 'none' | 'untranslated' | 'confirmed' | 'issues';
export type EditorSortBy = 'default' | 'source_length' | 'target_length';
export type EditorSortDirection = 'asc' | 'desc';

export interface SearchableEditorSegment {
  segment: Segment;
  sourceText: string;
  targetText: string;
  originalIndex: number;
  hasQaError: boolean;
  hasQaWarning: boolean;
  hasSaveError: boolean;
  isUntranslated: boolean;
  hasIssue: boolean;
}

export interface EditorFilterCriteria {
  sourceQuery: string;
  targetQuery: string;
  status: EditorStatusFilter;
  matchMode: EditorMatchMode;
  qualityFilters: EditorQualityFilter[];
  quickPreset: EditorQuickPreset;
  sortBy: EditorSortBy;
  sortDirection: EditorSortDirection;
}

export interface HighlightChunk {
  text: string;
  isMatch: boolean;
}

const normalizeSearchInput = (value: string): string => value.trim().toLocaleLowerCase();

export function createDefaultEditorFilterCriteria(): EditorFilterCriteria {
  return {
    sourceQuery: '',
    targetQuery: '',
    status: 'all',
    matchMode: 'contains',
    qualityFilters: [],
    quickPreset: 'none',
    sortBy: 'default',
    sortDirection: 'asc',
  };
}

export function textMatchesQuery(
  text: string,
  query: string,
  mode: EditorMatchMode = 'contains',
): boolean {
  const normalizedQuery = normalizeSearchInput(query);
  if (!normalizedQuery) return true;

  if (mode === 'contains') {
    return text.toLocaleLowerCase().includes(normalizedQuery);
  }

  if (mode === 'exact') {
    return text.trim().toLocaleLowerCase() === normalizedQuery;
  }

  try {
    const regex = new RegExp(query, 'i');
    return regex.test(text);
  } catch {
    return false;
  }
}

const qualityFilterPredicates: Record<
  EditorQualityFilter,
  (item: SearchableEditorSegment) => boolean
> = {
  qa_error: (item) => item.hasQaError,
  qa_warning: (item) => item.hasQaWarning,
  save_error: (item) => item.hasSaveError,
};

const quickPresetPredicates: Record<EditorQuickPreset, (item: SearchableEditorSegment) => boolean> =
  {
    none: () => true,
    untranslated: (item) => item.isUntranslated,
    confirmed: (item) => item.segment.status === 'confirmed',
    issues: (item) => item.hasIssue,
  };

export function countActiveFilterFields(criteria: EditorFilterCriteria): number {
  return (
    Number(criteria.sourceQuery.trim().length > 0) +
    Number(criteria.targetQuery.trim().length > 0) +
    Number(criteria.status !== 'all') +
    Number(criteria.matchMode !== 'contains') +
    Number(criteria.quickPreset !== 'none') +
    criteria.qualityFilters.length
  );
}

export function getQuickPresetPatch(
  preset: EditorQuickPreset,
): Pick<EditorFilterCriteria, 'status' | 'qualityFilters' | 'quickPreset'> {
  switch (preset) {
    case 'confirmed':
      return {
        status: 'all',
        qualityFilters: [],
        quickPreset: 'confirmed',
      };
    case 'issues':
      return {
        status: 'all',
        qualityFilters: [],
        quickPreset: 'issues',
      };
    case 'untranslated':
      return {
        status: 'all',
        qualityFilters: [],
        quickPreset: 'untranslated',
      };
    default:
      return {
        status: 'all',
        qualityFilters: [],
        quickPreset: 'none',
      };
  }
}

export function filterSearchableSegments(
  segments: SearchableEditorSegment[],
  criteria: EditorFilterCriteria,
): SearchableEditorSegment[] {
  return segments.filter((item) => {
    if (criteria.status !== 'all' && item.segment.status !== criteria.status) {
      return false;
    }

    if (criteria.qualityFilters.length > 0) {
      const hasQualityMatch = criteria.qualityFilters.some((quality) =>
        qualityFilterPredicates[quality](item),
      );
      if (!hasQualityMatch) {
        return false;
      }
    }

    if (!quickPresetPredicates[criteria.quickPreset](item)) {
      return false;
    }

    if (!textMatchesQuery(item.sourceText, criteria.sourceQuery, criteria.matchMode)) {
      return false;
    }

    if (!textMatchesQuery(item.targetText, criteria.targetQuery, criteria.matchMode)) {
      return false;
    }

    return true;
  });
}

export function sortSearchableSegments(
  segments: SearchableEditorSegment[],
  sortBy: EditorSortBy,
  sortDirection: EditorSortDirection,
): SearchableEditorSegment[] {
  if (sortBy === 'default') {
    return segments;
  }

  const direction = sortDirection === 'asc' ? 1 : -1;
  return [...segments].sort((left, right) => {
    const leftLength = sortBy === 'source_length' ? left.sourceText.length : left.targetText.length;
    const rightLength =
      sortBy === 'source_length' ? right.sourceText.length : right.targetText.length;

    if (leftLength === rightLength) {
      return left.originalIndex - right.originalIndex;
    }

    return (leftLength - rightLength) * direction;
  });
}

export function buildHighlightChunks(
  text: string,
  query: string,
  mode: EditorMatchMode = 'contains',
): HighlightChunk[] {
  const normalizedQuery = normalizeSearchInput(query);
  if (!text) return [];
  if (!normalizedQuery) return [{ text, isMatch: false }];

  if (mode === 'exact') {
    const isMatch = text.trim().toLocaleLowerCase() === normalizedQuery;
    return [{ text, isMatch }];
  }

  if (mode === 'regex') {
    try {
      const regex = new RegExp(query, 'gi');
      const chunks: HighlightChunk[] = [];
      let cursor = 0;
      let match = regex.exec(text);

      while (match) {
        const matchText = match[0];
        if (matchText.length === 0) {
          regex.lastIndex += 1;
          match = regex.exec(text);
          continue;
        }

        const start = match.index;
        const end = start + matchText.length;
        if (start > cursor) {
          chunks.push({ text: text.slice(cursor, start), isMatch: false });
        }
        chunks.push({ text: text.slice(start, end), isMatch: true });
        cursor = end;
        match = regex.exec(text);
      }

      if (cursor < text.length) {
        chunks.push({ text: text.slice(cursor), isMatch: false });
      }

      return chunks.length > 0 ? chunks : [{ text, isMatch: false }];
    } catch {
      return [{ text, isMatch: false }];
    }
  }

  const textLower = text.toLocaleLowerCase();
  const chunks: HighlightChunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = textLower.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      if (cursor < text.length) {
        chunks.push({ text: text.slice(cursor), isMatch: false });
      }
      break;
    }

    if (matchIndex > cursor) {
      chunks.push({ text: text.slice(cursor, matchIndex), isMatch: false });
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    chunks.push({ text: text.slice(matchIndex, matchEnd), isMatch: true });
    cursor = matchEnd;
  }

  return chunks.length > 0 ? chunks : [{ text, isMatch: false }];
}
