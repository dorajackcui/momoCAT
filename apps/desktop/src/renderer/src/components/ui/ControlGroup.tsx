import type { ReactNode } from 'react';
import { cx } from './cx';

export function ControlGroup({
  label,
  orientation = 'horizontal',
  variant = 'outlined',
  children,
  className,
}: {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'outlined' | 'plain';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-orientation={orientation}
      data-variant={variant}
      className={cx('ui-control-group', className)}
    >
      {children}
    </div>
  );
}
