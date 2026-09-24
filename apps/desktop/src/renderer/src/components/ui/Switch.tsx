import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onChange?: (checked: boolean) => void;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, className, onClick, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('ui-switch', className)}
      onClick={(event) => {
        onChange?.(!checked);
        onClick?.(event);
      }}
    >
      <span className="ui-switch-thumb" />
    </button>
  );
});
