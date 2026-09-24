import type { Segment } from '@cat/core/models';

export type EditorStatusFilter = Segment['status'];
export type EditorMatchMode = 'contains' | 'exact' | 'regex';
export type EditorTargetSearchScope = 'target' | 'context';
export type EditorQualityFilter = 'qa_issue' | 'save_error';
export type EditorSortBy = 'default' | 'source_length' | 'target_length';
export type EditorSortDirection = 'asc' | 'desc';
export type RepeatedSourceRole = 'first' | 'later';

export interface SearchableEditorSegment {
  segment: Segment;
  sourceText: string;
  targetText: string;
  originalIndex: number;

  hasQaIssue: boolean;
  hasSaveError: boolean;
  repeatedSourceRole?: RepeatedSourceRole;
}

export interface EditorFilterCriteria {
  sourceQuery: string;
  targetQuery: string;
  targetSearchScope: EditorTargetSearchScope;
  statuses: EditorStatusFilter[];
  matchMode: EditorMatchMode;
  qualityFilters: EditorQualityFilter[];
  firstRepeatOnly: boolean;
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
    targetSearchScope: 'target',
    statuses: [],
    matchMode: 'contains',
    qualityFilters: [],
    firstRepeatOnly: false,
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
  qa_issue: (item) => item.hasQaIssue,

  save_error: (item) => item.hasSaveError,
};

export function countActiveFilterFields(criteria: EditorFilterCriteria): number {
  return (
    Number(criteria.sourceQuery.trim().length > 0) +
    Number(criteria.targetQuery.trim().length > 0) +
    Number(criteria.statuses.length > 0) +
    Number(criteria.matchMode !== 'contains') +
    Number(criteria.firstRepeatOnly) +
    Number(criteria.qualityFilters.length > 0)
  );
}

export function toggleFilterSelection<T extends string>(selected: T[], value: T | 'all'): T[] {
  if (value === 'all') return [];
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

export function filterSearchableSegments(
  segments: SearchableEditorSegment[],
  criteria: EditorFilterCriteria,
): SearchableEditorSegment[] {
  const hasFilterCriteria =
    criteria.statuses.length > 0 ||
    criteria.qualityFilters.length > 0 ||
    criteria.firstRepeatOnly ||
    criteria.sourceQuery.trim().length > 0 ||
    criteria.targetQuery.trim().length > 0;

  if (!hasFilterCriteria) {
    return segments;
  }

  return segments.filter((item) => {
    if (criteria.firstRepeatOnly && item.repeatedSourceRole !== 'first') {
      return false;
    }
    if (criteria.statuses.length > 0 && !criteria.statuses.includes(item.segment.status)) {
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

    if (!textMatchesQuery(item.sourceText, criteria.sourceQuery, criteria.matchMode)) {
      return false;
    }

    const targetSearchText =
      criteria.targetSearchScope === 'context'
        ? (item.segment.meta.context ?? '')
        : item.targetText;
    if (!textMatchesQuery(targetSearchText, criteria.targetQuery, criteria.matchMode)) {
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
