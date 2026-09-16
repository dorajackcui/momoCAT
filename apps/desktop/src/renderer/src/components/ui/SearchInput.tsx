import { forwardRef, type ReactNode } from 'react';
import { Input, type InputProps } from './Input';
import { cx } from './cx';

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'appearance' | 'size'> & {
    trailingAction?: ReactNode;
  }
>(function SearchInput({ className, trailingAction, ...props }, ref) {
  return (
    <div className={cx('relative min-w-0', className)}>
      <Input
        {...props}
        ref={ref}
        appearance="search"
        className={cx('pl-8', trailingAction ? 'pr-10' : 'pr-3')}
      />
      <svg
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {trailingAction && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailingAction}</div>
      )}
    </div>
  );
});
