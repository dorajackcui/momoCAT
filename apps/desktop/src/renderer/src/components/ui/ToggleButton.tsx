import { forwardRef } from 'react';
import { Button, type ButtonProps } from './Button';
import { cx } from './cx';

const tones = {
  brand: 'border-brand/40 bg-brand-soft text-brand',
  warning: 'border-warning/40 bg-warning-soft text-warning',
  success: 'border-success/40 bg-success-soft text-success',
};

export const ToggleButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'variant'> & {
    pressed: boolean;
    tone?: keyof typeof tones;
  }
>(function ToggleButton({ pressed, tone = 'brand', className, ...props }, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      variant="secondary"
      aria-pressed={pressed}
      className={cx(pressed && tones[tone], className)}
    />
  );
});
