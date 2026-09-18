// Palette values live in palettes.css; components consume semantic CSS variables.
export const COLOR_THEMES = [
  { id: 'classic', label: 'Classic' },
  { id: 'nord', label: 'Nord' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['id'];
export const DEFAULT_COLOR_THEME: ColorTheme = 'classic';

export function isColorTheme(value: unknown): value is ColorTheme {
  return COLOR_THEMES.some((theme) => theme.id === value);
}
