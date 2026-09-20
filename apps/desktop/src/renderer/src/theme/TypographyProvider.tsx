import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemeScope } from './themePreferences';
import { readTypographyPreferences, saveTypography, type TypographyPreference } from './typography';

interface ActiveTypography {
  typography: TypographyPreference;
  setTypography: (next: TypographyPreference) => void;
}
const TypographyContext = createContext<ActiveTypography | null>(null);

export function TypographyProvider({
  scope,
  children,
}: {
  scope: ThemeScope;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(readTypographyPreferences);
  const typography = preferences[scope];
  useLayoutEffect(() => {
    const root = document.documentElement;
    const attributes = {
      'data-content-latin': typography.latin,
      'data-content-cjk': typography.cjk,
      'data-content-size': String(typography.fontSize),
      'data-typography-scope': scope,
    };
    const previous = Object.keys(attributes).map((key) => [key, root.getAttribute(key)] as const);
    Object.entries(attributes).forEach(([key, value]) => root.setAttribute(key, value));
    return () =>
      previous.forEach(([key, value]) => {
        if (value === null) root.removeAttribute(key);
        else root.setAttribute(key, value);
      });
  }, [scope, typography]);
  const setTypography = useCallback(
    (next: TypographyPreference) => {
      setPreferences((current) => ({ ...current, [scope]: next }));
      saveTypography(scope, next);
    },
    [scope],
  );
  const value = useMemo(() => ({ typography, setTypography }), [typography, setTypography]);
  return <TypographyContext.Provider value={value}>{children}</TypographyContext.Provider>;
}
export function useTypography(): ActiveTypography {
  const value = useContext(TypographyContext);
  if (!value) throw new Error('Typography controls must be inside TypographyProvider');
  return value;
}
