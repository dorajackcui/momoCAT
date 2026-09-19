import { forwardRef } from 'react';
import { Button, type ButtonProps } from './Button';

export const ToggleButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'variant' | 'tone'> & {
    pressed: boolean;
    tone?: 'brand' | 'warning' | 'success';
  }
>(function ToggleButton({ pressed, tone = 'brand', className, ...props }, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      variant="secondary"
      tone={pressed ? tone : 'neutral'}
      aria-pressed={pressed}
      className={className}
    />
  );
});
