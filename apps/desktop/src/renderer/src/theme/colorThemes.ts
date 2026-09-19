// Palette values live in palettes.css; components consume semantic CSS variables.
export const COLOR_THEMES = [
  { id: 'sand', label: 'Sand' },
  { id: 'classic', label: 'Classic' },
  { id: 'nord', label: 'Nord' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['id'];
export const DEFAULT_COLOR_THEMES = {
  workspace: 'sand',
  editor: 'classic',
} as const satisfies Record<string, ColorTheme>;

export function isColorTheme(value: unknown): value is ColorTheme {
  return COLOR_THEMES.some((theme) => theme.id === value);
}
