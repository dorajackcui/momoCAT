import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { fieldClasses, type FieldStyleProps } from './fieldStyles';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  tone?: FieldStyleProps['tone'];
  size?: FieldStyleProps['size'];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { tone = 'default', size = 'md', className, children, ...rest },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <select ref={ref} {...rest} {...focusProps} className={fieldClasses(tone, size, className)}>
      {children}
    </select>
  );
});
