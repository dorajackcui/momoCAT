import { useCallback, useState } from 'react';

export function useEditorFilterMenus() {
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setIsFilterMenuOpen(false);
    setIsSortMenuOpen(false);
  }, []);

  const toggleFilterMenu = useCallback(() => {
    setIsFilterMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsSortMenuOpen(false);
      }
      return next;
    });
  }, []);

  const toggleSortMenu = useCallback(() => {
    setIsSortMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsFilterMenuOpen(false);
      }
      return next;
    });
  }, []);

  return {
    isFilterMenuOpen,
    isSortMenuOpen,
    setIsFilterMenuOpen,
    setIsSortMenuOpen,
    toggleFilterMenu,
    toggleSortMenu,
    closeMenus,
  };
}
