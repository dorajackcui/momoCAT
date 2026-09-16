import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { fieldClasses, type FieldStyleProps } from './fieldStyles';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  tone?: FieldStyleProps['tone'];
  size?: FieldStyleProps['size'];
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { tone = 'default', size = 'md', className, ...rest },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <input ref={ref} {...rest} {...focusProps} className={fieldClasses(tone, size, className)} />
  );
});
