/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          chrome: 'rgb(var(--color-surface-chrome) / <alpha-value>)',
          panel: 'rgb(var(--color-surface-panel) / <alpha-value>)',
          navigation: 'rgb(var(--color-navigation) / <alpha-value>)',
        },
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          subtle: 'rgb(var(--color-border-subtle) / <alpha-value>)',
        },
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        focus: 'rgb(var(--color-focus) / <alpha-value>)',
        status: Object.fromEntries(
          ['new', 'draft', 'translated', 'reviewed', 'confirmed'].map((status) => [
            status,
            `rgb(var(--color-status-${status}) / <alpha-value>)`,
          ]),
        ),
        match: {
          exact: {
            DEFAULT: 'rgb(var(--color-match-exact) / <alpha-value>)',
            contrast: 'rgb(var(--color-match-exact-contrast) / <alpha-value>)',
          },
          fuzzy: {
            DEFAULT: 'rgb(var(--color-match-fuzzy) / <alpha-value>)',
            contrast: 'rgb(var(--color-match-fuzzy-contrast) / <alpha-value>)',
          },
          concordance: {
            DEFAULT: 'rgb(var(--color-match-concordance) / <alpha-value>)',
            contrast: 'rgb(var(--color-match-concordance-contrast) / <alpha-value>)',
          },
          term: {
            DEFAULT: 'rgb(var(--color-match-term) / <alpha-value>)',
            contrast: 'rgb(var(--color-match-term-contrast) / <alpha-value>)',
          },
        },
        text: {
          DEFAULT: 'rgb(var(--color-text) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
          faint: 'rgb(var(--color-text-faint) / <alpha-value>)',
          context: 'rgb(var(--color-editor-context) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
          solid: 'rgb(var(--color-brand-solid) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-brand-soft) / <alpha-value>)',
          contrast: 'rgb(var(--color-brand-contrast) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--color-success) / <alpha-value>)',
          hover: 'rgb(var(--color-success-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-success-soft) / <alpha-value>)',
          contrast: 'rgb(var(--color-success-contrast) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--color-warning) / <alpha-value>)',
          hover: 'rgb(var(--color-warning-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-warning-soft) / <alpha-value>)',
          contrast: 'rgb(var(--color-warning-contrast) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--color-danger) / <alpha-value>)',
          hover: 'rgb(var(--color-danger-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-danger-soft) / <alpha-value>)',
          contrast: 'rgb(var(--color-danger-contrast) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--color-info) / <alpha-value>)',
          hover: 'rgb(var(--color-info-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-info-soft) / <alpha-value>)',
          contrast: 'rgb(var(--color-info-contrast) / <alpha-value>)',
        },
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
        control: 'var(--radius-control)',
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        float: 'var(--shadow-float)',
        focus: 'var(--shadow-focus)',
      },
      fontFamily: {
        sans: ['var(--font-interface)'],
        mono: ['var(--font-mono)'],
      },
      lineHeight: {
        gutter: 'var(--line-height-gutter)',
        context: 'var(--line-height-context)',
      },
      fontSize: Object.fromEntries(
        [
          '2xs',
          'xs',
          'sm',
          'base',
          'lg',
          'xl',
          '2xl',
          '3xl',
          'caption',
          'reference',
          'reference-meta',
          'reference-badge',
          'gutter-marker',
        ].map((size) => [
          size,
          [`var(--font-size-${size})`, { lineHeight: 'var(--line-height-interface)' }],
        ]),
      ),
    },
  },
  plugins: [],
};
