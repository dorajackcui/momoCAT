import { cva } from 'class-variance-authority';

// shadcn-style variants over native controls; geometry and colors live in CSS tokens.
// Keep a single size scale for text buttons, icon buttons and form fields.
const sizes = { xs: 'ui-size-xs', sm: 'ui-size-sm', md: 'ui-size-md', lg: 'ui-size-lg' };

export const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      primary: 'ui-button-primary',
      secondary: 'ui-button-secondary',
      soft: 'ui-button-soft',
      ghost: 'ui-button-ghost',
      link: 'ui-button-link',
      overlay: 'ui-button-overlay',
    },
    size: sizes,
    shape: { text: '', icon: 'ui-button-icon' },
  },
  defaultVariants: { variant: 'secondary', size: 'md', shape: 'text' },
});

export interface FieldStyleProps {
  tone?: 'default' | 'danger' | 'success';
  size?: keyof typeof sizes | 'compact';
  appearance?: 'default' | 'subtle' | 'floating' | 'inline' | 'search';
}

export const fieldVariants = cva('ui-field', {
  variants: {
    tone: { default: '', danger: 'ui-field-danger', success: 'ui-field-success' },
    size: { ...sizes, compact: sizes.md },
    appearance: {
      default: '',
      subtle: 'ui-field-subtle',
      floating: 'ui-field-floating',
      inline: 'ui-field-inline',
      search: 'ui-field-search',
    },
  },
  defaultVariants: { tone: 'default', size: 'md', appearance: 'default' },
});
