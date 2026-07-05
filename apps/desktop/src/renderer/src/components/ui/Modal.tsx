import React from 'react';
import { cx } from './cx';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bodyClassName?: string;
  className?: string;
  /** Extra classes on the fixed backdrop, e.g. a z-index override to stack above other modals. */
  backdropClassName?: string;
  children: React.ReactNode;
}

const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  footer,
  closeOnBackdrop = true,
  size = 'md',
  bodyClassName,
  className,
  backdropClassName,
  children,
}: ModalProps) => {
  if (!open) return null;

  return (
    <div
      className={cx('modal-backdrop', backdropClassName)}
      onClick={() => {
        if (closeOnBackdrop) onClose?.();
      }}
    >
      <div
        className={cx('modal-card', sizeClass[size], className)}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className="modal-header">
            <div className="text-xl font-bold text-text">{title}</div>
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
        )}
        <div className={cx('modal-body', bodyClassName)}>{children}</div>
        {footer && <div className="panel-footer flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
