import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { fieldVariants, type FieldStyleProps } from './controlVariants';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  tone?: FieldStyleProps['tone'];
  size?: FieldStyleProps['size'];
  appearance?: FieldStyleProps['appearance'];
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { tone = 'default', size = 'md', appearance = 'default', className, ...rest },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <input
      ref={ref}
      {...rest}
      {...focusProps}
      className={fieldVariants({ tone, size, className, appearance })}
    />
  );
});
