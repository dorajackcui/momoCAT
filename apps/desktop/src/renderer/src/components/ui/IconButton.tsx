import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { cx } from './cx';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'neutral' | 'brand' | 'danger' | 'success';
  variant?: 'outline' | 'ghost' | 'overlay';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const toneClass: Record<NonNullable<IconButtonProps['tone']>, string> = {
  neutral: 'icon-btn-neutral',
  brand: 'icon-btn-brand',
  danger: 'icon-btn-danger',
  success: 'icon-btn-success',
};

const sizeClass: Record<NonNullable<IconButtonProps['size']>, string> = {
  xs: 'h-6 w-6',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    tone = 'neutral',
    variant = 'outline',
    size = 'md',
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      {...focusProps}
      data-variant={variant}
      className={cx('icon-btn', toneClass[tone], sizeClass[size], className)}
    >
      {children}
    </button>
  );
});
