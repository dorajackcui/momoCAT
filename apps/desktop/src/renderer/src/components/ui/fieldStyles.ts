import { cx } from './cx';

export interface FieldStyleProps {
  tone?: 'default' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

const tones = { default: '', danger: 'field-input-danger', success: 'field-input-success' };
const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-4 py-2.5 text-sm' };

export function fieldClasses(
  tone: NonNullable<FieldStyleProps['tone']>,
  size: NonNullable<FieldStyleProps['size']>,
  className?: string,
) {
  return cx('field-input', tones[tone], sizes[size], className);
}
