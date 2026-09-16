import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { fieldClasses, type FieldStyleProps } from './fieldStyles';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: FieldStyleProps['tone'];
  size?: FieldStyleProps['size'];
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { tone = 'default', size = 'md', className, ...rest },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <textarea ref={ref} {...rest} {...focusProps} className={fieldClasses(tone, size, className)} />
  );
});
