import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface WorkspaceActionMenuProps {
  id: string;
  label: string;
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}

export function WorkspaceActionMenu({
  id,
  label,
  anchor,
  onClose,
  children,
}: WorkspaceActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const positionMenu = () => {
      const trigger = anchor.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const preferredLeft = trigger.right - bounds.width;
      const preferredTop = trigger.bottom + 6;
      menu.style.left = `${Math.max(8, Math.min(preferredLeft, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(preferredTop, window.innerHeight - bounds.height - 8))}px`;
    };
    positionMenu();
    const items = () =>
      Array.from(
        menu.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)'),
      );
    items()[0]?.focus();
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.contains(event.target) &&
        !anchor.contains(event.target)
      )
        onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        anchor.focus();
        return;
      }
      if (
        !menu.contains(event.target as Node) ||
        !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
      )
        return;
      event.preventDefault();
      const buttons = items();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={menuRef} id={id} className="workspace-action-menu" role="menu" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}
