import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

const SIDEBAR_MIN_WIDTH = 220;

export interface EditorLayoutController {
  layoutRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  startSidebarResize: () => void;
}

export function useEditorLayout(): EditorLayoutController {
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const onMouseMove = (event: MouseEvent) => {
      const layoutRect = layoutRef.current?.getBoundingClientRect();
      if (!layoutRect) return;

      const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(layoutRect.width / 3));
      const nextWidth = layoutRect.right - event.clientX;
      const clampedWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(nextWidth, maxWidth));
      setSidebarWidth(clampedWidth);
    };

    const onMouseUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const clampSidebarByViewport = () => {
      const layoutWidth = layoutRef.current?.clientWidth;
      if (!layoutWidth) return;
      const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(layoutWidth / 3));
      setSidebarWidth((prev) => Math.max(SIDEBAR_MIN_WIDTH, Math.min(prev, maxWidth)));
    };

    clampSidebarByViewport();
    window.addEventListener('resize', clampSidebarByViewport);
    return () => window.removeEventListener('resize', clampSidebarByViewport);
  }, []);

  const startSidebarResize = useCallback(() => setIsResizingSidebar(true), []);

  return {
    layoutRef,
    sidebarWidth,
    startSidebarResize,
  };
}
