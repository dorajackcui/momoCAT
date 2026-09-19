import { useAutoFocusProps } from './autoFocus';
import React from 'react';
import { fieldVariants, type FieldStyleProps } from './controlVariants';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: FieldStyleProps['tone'];
  size?: FieldStyleProps['size'];
  appearance?: FieldStyleProps['appearance'];
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { tone = 'default', size = 'md', appearance = 'default', className, ...rest },
  ref,
) {
  const focusProps = useAutoFocusProps(rest.autoFocus);
  return (
    <textarea
      ref={ref}
      {...rest}
      {...focusProps}
      className={fieldVariants({ tone, size, className, appearance })}
    />
  );
});
