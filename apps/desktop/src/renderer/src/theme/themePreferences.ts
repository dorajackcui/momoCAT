import { DEFAULT_COLOR_THEME, isColorTheme, type ColorTheme } from './colorThemes';

// Separate preferences let a surface opt in without changing other workspaces.
export const THEME_STORAGE_KEYS = {
  workspace: 'momocat.workspace.colorTheme',
  editor: 'momocat.editor.colorTheme',
} as const;

export type ThemeScope = keyof typeof THEME_STORAGE_KEYS;
export type ThemePreferences = Record<ThemeScope, ColorTheme>;

function readTheme(scope: ThemeScope): ColorTheme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEYS[scope]);
    // Preserve the light/dark intent of the earlier reader palette trial.
    if (saved === 'charcoal') return 'nord';
    return isColorTheme(saved) ? saved : DEFAULT_COLOR_THEME;
  } catch {
    return DEFAULT_COLOR_THEME;
  }
}

export function readThemePreferences(): ThemePreferences {
  return { workspace: readTheme('workspace'), editor: readTheme('editor') };
}

export function saveThemePreference(scope: ThemeScope, theme: ColorTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEYS[scope], theme);
  } catch {
    // A blocked/full store must not prevent changing the current appearance.
  }
}
