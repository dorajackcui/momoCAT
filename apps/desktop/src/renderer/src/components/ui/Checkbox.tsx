import { useAutoFocusProps } from './autoFocus';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx';

type CheckableProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckableProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  const focusProps = useAutoFocusProps(props.autoFocus);
  return (
    <input
      {...props}
      {...focusProps}
      ref={ref}
      type="checkbox"
      className={cx('ui-checkable', className)}
    />
  );
});

export const Radio = forwardRef<HTMLInputElement, CheckableProps>(function Radio(
  { className, ...props },
  ref,
) {
  const focusProps = useAutoFocusProps(props.autoFocus);
  return (
    <input
      {...props}
      {...focusProps}
      ref={ref}
      type="radio"
      className={cx('ui-checkable', className)}
    />
  );
});
