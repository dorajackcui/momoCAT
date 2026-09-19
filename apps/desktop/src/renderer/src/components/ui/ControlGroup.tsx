import type { ReactNode } from 'react';
import { cx } from './cx';

export function ControlGroup({
  label,
  orientation = 'horizontal',
  children,
  className,
}: {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-orientation={orientation}
      className={cx('ui-control-group', className)}
    >
      {children}
    </div>
  );
}
