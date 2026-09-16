import * as Primitive from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './cx';

export const Tabs = Primitive.Root;

export function TabsList({
  label,
  items,
  variant = 'neutral',
  className,
}: {
  label: string;
  items: Array<{ value: string; label: ReactNode; title?: string; disabled?: boolean }>;
  variant?: 'neutral' | 'brand' | 'underline';
  className?: string;
}) {
  return (
    <Primitive.List
      aria-label={label}
      className={cx('ui-tabs-list', `ui-tabs-${variant}`, className)}
    >
      {items.map(({ value, label: itemLabel, ...props }) => (
        <Primitive.Trigger key={value} value={value} {...props} className="ui-tab">
          {itemLabel}
        </Primitive.Trigger>
      ))}
    </Primitive.List>
  );
}

export function TabsPanel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      {...props}
      className={cx(
        'min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        className,
      )}
    />
  );
}
