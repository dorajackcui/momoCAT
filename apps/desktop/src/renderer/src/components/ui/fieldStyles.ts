import { cx } from './cx';

export interface FieldStyleProps {
  tone?: 'default' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'compact';
  appearance?: 'default' | 'subtle' | 'floating' | 'inline' | 'search';
}

const tones = { default: '', danger: 'field-input-danger', success: 'field-input-success' };
const sizes = {
  xs: 'px-2.5 py-1 text-[11px]',
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
  compact: 'px-3 py-2 text-sm',
};
const appearances = {
  default: '',
  subtle: 'field-subtle',
  floating: 'field-floating',
  inline: 'field-inline',
  search: 'field-search',
};

export function fieldClasses(
  tone: NonNullable<FieldStyleProps['tone']>,
  size: NonNullable<FieldStyleProps['size']>,
  className?: string,
  appearance: NonNullable<FieldStyleProps['appearance']> = 'default',
) {
  return cx('field-input', tones[tone], sizes[size], appearances[appearance], className);
}
