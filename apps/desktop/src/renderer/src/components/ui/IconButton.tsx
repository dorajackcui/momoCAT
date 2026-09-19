import React from 'react';
import { Button } from './Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'neutral' | 'brand' | 'danger' | 'success';
  variant?: 'outline' | 'ghost' | 'overlay';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

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
  return (
    <Button
      ref={ref}
      type={type}
      {...rest}
      shape="icon"
      tone={tone}
      size={size}
      variant={variant === 'outline' ? (tone === 'neutral' ? 'secondary' : 'soft') : variant}
      className={className}
    >
      {children}
    </Button>
  );
});
