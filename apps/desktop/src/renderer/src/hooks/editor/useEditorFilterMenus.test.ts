// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useEditorFilterMenus } from './useEditorFilterMenus';

it('keeps filter and sort menus mutually exclusive and lets triggers toggle them', () => {
  const { result } = renderHook(useEditorFilterMenus);
  act(() => result.current.toggleFilterMenu());
  expect(result.current.isFilterMenuOpen).toBe(true);
  act(() => result.current.toggleSortMenu());
  expect(result.current.isFilterMenuOpen).toBe(false);
  expect(result.current.isSortMenuOpen).toBe(true);
  act(() => result.current.toggleSortMenu());
  expect(result.current.isSortMenuOpen).toBe(false);
  act(() => result.current.toggleFilterMenu());
  act(() => result.current.toggleFilterMenu());
  expect(result.current.isFilterMenuOpen).toBe(false);
});

it('does not reopen a dismissed menu or close a different menu from a late dismissal', () => {
  const { result } = renderHook(useEditorFilterMenus);
  act(() => result.current.toggleFilterMenu());
  const dismissFilter = result.current.closeFilterMenu;
  act(dismissFilter);
  act(dismissFilter);
  expect(result.current.isFilterMenuOpen).toBe(false);

  act(() => result.current.toggleSortMenu());
  act(dismissFilter);
  expect(result.current.isSortMenuOpen).toBe(true);
  const dismissSort = result.current.closeSortMenu;
  act(dismissSort);
  act(dismissSort);
  expect(result.current.isSortMenuOpen).toBe(false);

  act(() => result.current.toggleFilterMenu());
  act(dismissSort);
  expect(result.current.isFilterMenuOpen).toBe(true);
  act(() => result.current.closeMenus());
  expect(result.current.isFilterMenuOpen).toBe(false);
  expect(result.current.isSortMenuOpen).toBe(false);
});
