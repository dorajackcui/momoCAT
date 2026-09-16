import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'soft' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  iconOnly?: boolean;
}

const variantClass: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  soft: 'btn-soft',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

const sizeClass: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-sm px-5 py-2.5',
};

const iconOnlySizeClass: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 w-8 px-0 py-0',
  md: 'h-9 w-9 px-0 py-0',
  lg: 'h-10 w-10 px-0 py-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconOnly = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      {...focusProps}
      disabled={isDisabled}
      className={cx(
        variantClass[variant],
        iconOnly ? iconOnlySizeClass[size] : sizeClass[size],
        className,
      )}
    >
      {loading && <Spinner size="sm" tone={variant === 'danger' ? 'danger' : 'brand'} />}
      {!loading && children}
      {loading && children && <span className="opacity-80">{children}</span>}
    </button>
  );
});
