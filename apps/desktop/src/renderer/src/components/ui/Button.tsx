import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

type ButtonTone = 'brand' | 'success' | 'danger';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
} & (
    | {
        variant?: 'primary' | 'secondary' | 'soft' | 'ghost';
        tone?: ButtonTone;
        size?: 'xs' | 'sm' | 'md' | 'lg';
      }
    | { variant: 'link'; tone?: ButtonTone | 'neutral' | 'inherit'; size?: never }
  );

const variantClass: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  soft: 'btn-soft',
  ghost: 'btn-ghost',
  link: 'btn-link',
};

const sizeClass: Record<NonNullable<ButtonProps['size']>, string> = {
  xs: 'text-[11px] px-2.5 py-1',
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-sm px-5 py-2.5',
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
      className={cx(
        'btn-base',
        variantClass[variant],
        variant !== 'link' && sizeClass[size],
        className,
      )}
    >
      {loading && <Spinner size="sm" tone={tone === 'danger' ? 'danger' : 'brand'} />}
      {!loading && children}
      {loading && children && <span className="opacity-80">{children}</span>}
    </button>
  );
});
