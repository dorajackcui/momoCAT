import { describe, expect, it, vi } from 'vitest';
import {
  buildEditorFilterStorageKey,
  loadPersistedFilterState,
  persistFilterState,
} from './editor/editorFilterStateStorage';
import { createDefaultEditorFilterCriteria } from '../components/editorFilterUtils';
import { sanitizePersistedEditorFilterState } from './useEditorFilters';

function installWindowLocalStorage(): {
  store: Record<string, string>;
} {
  const store: Record<string, string> = {};
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) =>
        Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
  return { store };
}

describe('editor filter storage behaviors', () => {
  it('hydrates persisted state with sanitization', () => {
    const { store } = installWindowLocalStorage();
    const key = buildEditorFilterStorageKey(22);
    store[key] = JSON.stringify({
      sourceQuery: 'abc',
      targetQuery: 'xyz',
      status: 'draft',
      matchMode: 'contains',
      qualityFilters: ['qa_error'],
      quickPreset: 'none',
      sortBy: 'default',
      sortDirection: 'asc',
    });

    const state = loadPersistedFilterState({
      fileId: 22,
      sanitize: sanitizePersistedEditorFilterState,
      onError: vi.fn(),
    });

    expect(state.sourceQuery).toBe('abc');
    expect(state.targetQuery).toBe('xyz');
    expect(state.targetSearchScope).toBe('target');
    expect(state.status).toBe('draft');
  });

  it('falls back to defaults and reports malformed JSON', () => {
    const { store } = installWindowLocalStorage();
    const key = buildEditorFilterStorageKey(23);
    store[key] = '{malformed-json';
    const onError = vi.fn();

    const state = loadPersistedFilterState({
      fileId: 23,
      sanitize: sanitizePersistedEditorFilterState,
      onError,
    });

    expect(state).toEqual(createDefaultEditorFilterCriteria());
    expect(onError).toHaveBeenCalled();
  });

  it('persists current filter state using stable storage key', () => {
    const { store } = installWindowLocalStorage();
    const key = buildEditorFilterStorageKey(24);
    const filterState = {
      ...createDefaultEditorFilterCriteria(),
      sourceQuery: 'persist-me',
      sortBy: 'source_length' as const,
      sortDirection: 'desc' as const,
    };

    persistFilterState({
      fileId: 24,
      filterState,
      onError: vi.fn(),
    });

    expect(store[key]).toBe(JSON.stringify(filterState));
  });
});
