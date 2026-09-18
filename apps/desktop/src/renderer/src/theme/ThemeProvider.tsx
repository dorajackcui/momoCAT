import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ColorTheme } from './colorThemes';
import { readThemePreferences, saveThemePreference, type ThemeScope } from './themePreferences';

interface ActiveTheme {
  theme: ColorTheme;
  setTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ActiveTheme | null>(null);

// Apply at the document root so body portals and feedback share the page palette.
// This is the only DOM theme boundary, shared by every application surface.
export function useDocumentTheme(theme: ColorTheme | null): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-color-theme');
    if (theme) root.setAttribute('data-color-theme', theme);
    else root.removeAttribute('data-color-theme');
    return () => {
      if (previous === null) root.removeAttribute('data-color-theme');
      else root.setAttribute('data-color-theme', previous);
    };
  }, [theme]);
}

export function ThemeProvider({ scope, children }: { scope: ThemeScope; children: ReactNode }) {
  const [preferences, setPreferences] = useState(readThemePreferences);
  const theme = preferences[scope];
  useDocumentTheme(theme);

  const setTheme = useCallback(
    (next: ColorTheme) => {
      setPreferences((current) => ({ ...current, [scope]: next }));
      saveThemePreference(scope, next);
    },
    [scope],
  );
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ActiveTheme {
  const preferences = useContext(ThemeContext);
  if (!preferences) throw new Error('Theme controls must be inside ThemeProvider');
  return preferences;
}
