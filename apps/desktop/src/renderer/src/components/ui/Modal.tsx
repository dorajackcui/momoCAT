import { useId, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { OverlayContainerContext } from './overlayContainer';
import { ModalAutoFocusContext } from './autoFocus';

export interface ModalProps {
  open: boolean;
  /** Omit for a blocking operation: no Escape, backdrop or close button dismissal. */
  onClose?: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}

const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-4xl' };

export function Modal({ open, ...props }: ModalProps) {
  return open ? <OpenModal {...props} /> : null;
}

function OpenModal({
  onClose,
  title,
  description,
  footer,
  closeOnBackdrop = true,
  size = 'md',
  bodyClassName,
  className,
  children,
}: Omit<ModalProps, 'open'>) {
  const descriptionId = useId();
  // Capture before child autoFocus runs; the opener need not be a Dialog.Trigger.
  const [returnFocus] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <ModalAutoFocusContext.Provider value>
      <Dialog.Root
        open
        onOpenChange={(next) => {
          if (!next) onClose?.();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-layer modal-backdrop">
            <Dialog.Content
              ref={setContainer}
              className={cx('modal-card', sizeClass[size], className)}
              aria-modal="true"
              aria-describedby={description ? descriptionId : undefined}
              onOpenAutoFocus={(event) => {
                const target = (event.target as HTMLElement).querySelector<HTMLElement>(
                  '[data-ui-autofocus]:not(:disabled)',
                );
                if (target) {
                  event.preventDefault();
                  target.focus();
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const target = returnFocus;
                if (target?.isConnected && !target.closest('[inert]')) target.focus();
              }}
              onEscapeKeyDown={(event) => {
                if (!onClose || container?.querySelector('[data-ui-popup]')) event.preventDefault();
              }}
              onInteractOutside={(event) => {
                if (!onClose || !closeOnBackdrop) event.preventDefault();
              }}
            >
              <div className="modal-header">
                <div>
                  <Dialog.Title className="text-xl font-bold text-text">{title}</Dialog.Title>
                  {description && (
                    <Dialog.Description id={descriptionId} className="mt-1 text-sm text-text-muted">
                      {description}
                    </Dialog.Description>
                  )}
                </div>
                {onClose && (
                  <IconButton onClick={onClose} tone="neutral" aria-label="Close">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </IconButton>
                )}
              </div>
              <OverlayContainerContext.Provider value={container}>
                <div className={cx('modal-body', bodyClassName)}>{children}</div>
                {footer && (
                  <div className="panel-footer flex shrink-0 items-center justify-end gap-3">
                    {footer}
                  </div>
                )}
              </OverlayContainerContext.Provider>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </ModalAutoFocusContext.Provider>
  );
}
