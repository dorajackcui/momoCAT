import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { cx } from './cx';
import { OverlayContainerContext } from './overlayContainer';

export type PopupAnchor = HTMLElement | RefObject<HTMLElement | null> | { x: number; y: number };
interface PopupProps {
  open?: boolean;
  anchor: PopupAnchor;
  onClose: () => void;
  label: string;
  id?: string;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}

const MenuContext = createContext<{
  activeIndex: number | null;
  getItemProps: ReturnType<typeof useInteractions>['getItemProps'];
  onClose: () => void;
} | null>(null);

// One owner for positioning, portals, dismissal and focus; menu adds roving item navigation.
function PopupSurface({
  anchor,
  onClose,
  label,
  id,
  placement = 'bottom-end',
  className,
  children,
  menu,
}: PopupProps & { menu: boolean }) {
  const portalRoot = useContext(OverlayContainerContext);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const {
    refs: { setFloating, setReference, setPositionReference, domReference },
    floatingStyles,
    context,
  } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  useLayoutEffect(() => {
    if ('x' in anchor) {
      setPositionReference({
        getBoundingClientRect: () => ({
          x: anchor.x,
          y: anchor.y,
          left: anchor.x,
          right: anchor.x,
          top: anchor.y,
          bottom: anchor.y,
          width: 0,
          height: 0,
        }),
      });
    } else {
      setReference('current' in anchor ? anchor.current : anchor);
    }
  }, [anchor, setPositionReference, setReference]);
  const dismiss = useDismiss(context, { bubbles: false });
  const role = useRole(context, { role: menu ? 'menu' : 'dialog' });
  const navigation = useListNavigation(context, {
    enabled: menu,
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    focusItemOnOpen: true,
  });
  const { getFloatingProps, getItemProps } = useInteractions([dismiss, role, navigation]);
  const value = useMemo(
    () => ({
      activeIndex,
      getItemProps,
      onClose: () => {
        // Restore before invoking an action that may open a dialog or focus the editor.
        const target = domReference.current ?? opener;
        if (target instanceof HTMLElement && target.isConnected && !target.closest('[inert]'))
          target.focus();
        onClose();
      },
    }),
    [activeIndex, getItemProps, onClose, opener, domReference],
  );

  return (
    <FloatingPortal root={portalRoot ?? undefined}>
      <FloatingFocusManager context={context} modal={false} returnFocus restoreFocus>
        <div
          ref={setFloating}
          style={floatingStyles}
          {...getFloatingProps({
            id,
            'aria-label': label,
            onClick: (event) => event.stopPropagation(),
          })}
          data-ui-popup=""
          className={cx('ui-layer ui-popup', menu ? 'w-64 p-1.5' : 'p-3', className)}
        >
          <MenuContext.Provider value={value}>
            <FloatingList elementsRef={listRef}>{children}</FloatingList>
          </MenuContext.Provider>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}

export function Menu({ open = true, ...props }: PopupProps) {
  return open ? <PopupSurface {...props} menu /> : null;
}

export function Popover({ open = true, ...props }: PopupProps) {
  return open ? <PopupSurface {...props} menu={false} /> : null;
}

export function MenuItem({
  onClick,
  className,
  disabled,
  danger,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  const menu = useContext(MenuContext);
  const { ref, index } = useListItem();
  if (!menu) throw new Error('MenuItem must be inside Menu');
  return (
    <button
      {...menu.getItemProps({
        ...props,
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          menu.onClose();
          onClick?.(event);
        },
      })}
      ref={ref}
      type="button"
      role="menuitem"
      disabled={disabled}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      className={cx('ui-menu-item', danger && 'text-danger', className)}
    />
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 text-xs text-text-faint break-words">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-border/60" />;
}
