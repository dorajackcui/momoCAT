import { useCallback, useState } from 'react';

export function useEditorFilterMenus() {
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | null>(null);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const closeFilterMenu = useCallback(() => {
    setOpenMenu((current) => (current === 'filter' ? null : current));
  }, []);

  const closeSortMenu = useCallback(() => {
    setOpenMenu((current) => (current === 'sort' ? null : current));
  }, []);

  const toggleFilterMenu = useCallback(() => {
    setOpenMenu((current) => (current === 'filter' ? null : 'filter'));
  }, []);

  const toggleSortMenu = useCallback(() => {
    setOpenMenu((current) => (current === 'sort' ? null : 'sort'));
  }, []);

  return {
    isFilterMenuOpen: openMenu === 'filter',
    isSortMenuOpen: openMenu === 'sort',
    closeFilterMenu,
    closeSortMenu,
    toggleFilterMenu,
    toggleSortMenu,
    closeMenus,
  };
}
