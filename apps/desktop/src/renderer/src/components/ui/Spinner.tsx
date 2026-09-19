import React from 'react';
import { cx } from './cx';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'inherit';
  className?: string;
}

const sizeClass: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-7 w-7 border-[3px]',
};

const toneClass: Record<NonNullable<SpinnerProps['tone']>, string> = {
  inherit: 'border-current border-t-transparent',
  brand: 'border-brand border-t-transparent',
  neutral: 'border-text-faint border-t-transparent',
  success: 'border-success border-t-transparent',
  warning: 'border-warning border-t-transparent',
  danger: 'border-danger border-t-transparent',
  info: 'border-info border-t-transparent',
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  tone = 'brand',
  className,
}: SpinnerProps) => {
  return (
    <span
      className={cx(
        'inline-block animate-spin rounded-full',
        sizeClass[size],
        toneClass[tone],
        className,
      )}
      aria-hidden="true"
    />
  );
};
