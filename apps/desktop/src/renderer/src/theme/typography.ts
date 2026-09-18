import type { ThemeScope } from './themePreferences';

export const LATIN_FONTS = [
  { id: 'source-serif', label: 'Source Serif 4' },
  { id: 'source-sans', label: 'Source Sans 3' },
] as const;
export const CJK_FONTS = [
  { id: 'noto-sans', label: 'Noto Sans SC · 黑体' },
  { id: 'noto-serif', label: 'Noto Serif SC · 宋体' },
] as const;
export const CONTENT_FONT_SIZES = [14, 16] as const;
export interface TypographyPreference {
  latin: (typeof LATIN_FONTS)[number]['id'];
  cjk: (typeof CJK_FONTS)[number]['id'];
  fontSize: (typeof CONTENT_FONT_SIZES)[number];
}
export const DEFAULT_TYPOGRAPHY: TypographyPreference = {
  latin: 'source-serif',
  cjk: 'noto-sans',
  fontSize: 16,
};
export const TYPOGRAPHY_STORAGE_KEYS = {
  workspace: 'momocat.workspace.typography',
  editor: 'momocat.editor.typography',
} as const;

function readTypography(scope: ThemeScope): TypographyPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(TYPOGRAPHY_STORAGE_KEYS[scope]) ?? 'null');
    return {
      latin: LATIN_FONTS.find((font) => font.id === saved?.latin)?.id ?? DEFAULT_TYPOGRAPHY.latin,
      cjk: CJK_FONTS.find((font) => font.id === saved?.cjk)?.id ?? DEFAULT_TYPOGRAPHY.cjk,
      fontSize:
        CONTENT_FONT_SIZES.find((size) => size === saved?.fontSize) ?? DEFAULT_TYPOGRAPHY.fontSize,
    };
  } catch {
    return { ...DEFAULT_TYPOGRAPHY };
  }
}
export function readTypographyPreferences(): Record<ThemeScope, TypographyPreference> {
  return { editor: readTypography('editor'), workspace: readTypography('workspace') };
}
export function saveTypography(scope: ThemeScope, preference: TypographyPreference): void {
  try {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEYS[scope], JSON.stringify(preference));
  } catch {
    /* Storage failures must not block the current choice. */
  }
}
