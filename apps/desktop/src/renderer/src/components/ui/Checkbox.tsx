import { useAutoFocusProps } from './autoFocus';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx';

type CheckableProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  tone?: 'brand' | 'success' | 'info';
};

const toneClass = { brand: 'accent-brand', success: 'accent-success', info: 'accent-info' };

export const Checkbox = forwardRef<HTMLInputElement, CheckableProps>(function Checkbox(
  { className, tone = 'brand', ...props },
  ref,
) {
  const focusProps = useAutoFocusProps(props.autoFocus);
  return (
    <input
      {...props}
      {...focusProps}
      ref={ref}
      type="checkbox"
      className={cx('ui-checkable', toneClass[tone], className)}
    />
  );
});

export const Radio = forwardRef<HTMLInputElement, CheckableProps>(function Radio(
  { className, tone = 'brand', ...props },
  ref,
) {
  const focusProps = useAutoFocusProps(props.autoFocus);
  return (
    <input
      {...props}
      {...focusProps}
      ref={ref}
      type="radio"
      className={cx('ui-checkable', toneClass[tone], className)}
    />
  );
});
