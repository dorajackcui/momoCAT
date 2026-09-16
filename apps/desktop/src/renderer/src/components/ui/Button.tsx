import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

type ButtonTone = 'brand' | 'success' | 'danger';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'inline' | 'badge';
  loading?: boolean;
} & (
    | { variant?: 'primary' | 'secondary' | 'soft' | 'danger' | 'ghost'; tone?: ButtonTone }
    | { variant: 'link'; tone?: ButtonTone | 'neutral' | 'inherit' }
  );

const variantClass: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  soft: 'btn-soft',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
  link: 'btn-link',
};

const sizeClass: Record<NonNullable<ButtonProps['size']>, string> = {
  xs: 'text-[11px] px-2.5 py-1',
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-sm px-5 py-2.5',
  inline: 'p-0 text-inherit [font-weight:inherit]',
  badge: 'text-[10px] px-1.5 py-0.5 tracking-wider',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    tone,
    size = 'md',
    loading = false,
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
      data-tone={tone}
      className={cx('btn-base', variantClass[variant], sizeClass[size], className)}
    >
      {loading && <Spinner size="sm" tone={variant === 'danger' ? 'danger' : 'brand'} />}
      {!loading && children}
      {loading && children && <span className="opacity-80">{children}</span>}
    </button>
  );
});
