import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { Spinner } from './Spinner';
import { buttonVariants } from './controlVariants';

type ButtonTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  shape?: 'text' | 'icon';
} & (
    | {
        variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'overlay';
        tone?: ButtonTone;
        size?: 'xs' | 'sm' | 'md' | 'lg';
      }
    | { variant: 'link'; tone?: ButtonTone | 'inherit'; size?: never }
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    tone,
    size = 'md',
    shape = 'text',
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
      data-slot="button"
      data-tone={
        tone ??
        (variant === 'primary' || variant === 'soft' || variant === 'link' ? 'brand' : 'neutral')
      }
      aria-busy={loading || rest['aria-busy']}
      className={buttonVariants({
        variant,
        size: variant === 'link' ? null : size,
        shape,
        className,
      })}
    >
      {loading && <Spinner size="sm" tone="inherit" />}
      {!loading && children}
      {loading && children && <span className="opacity-80">{children}</span>}
    </button>
  );
});
