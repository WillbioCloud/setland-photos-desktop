import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'setland-theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

/** Injeta/remove a classe `.dark` na raiz (`<html>`) — única fonte de verdade do Tailwind. */
function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* localStorage indisponível (ex.: modo restrito) — usa o padrão do quiosque */
  }
  return 'dark';
}

interface ThemeContextValue {
  /** Preferência do usuário: claro, escuro ou automático (OS). */
  theme: ThemeMode;
  /** Tema efetivamente aplicado após resolver `system`. */
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
  /** Alterna claro → escuro → sistema → claro… */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CYCLE_ORDER: ThemeMode[] = ['light', 'dark', 'system'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  );

  // Aplica a classe `.dark` na raiz + persiste a preferência.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* noop */
    }
  }, [theme]);

  // Sincroniza em tempo real com o OS quando `theme === 'system'`.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      applyTheme(next);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => CYCLE_ORDER[(CYCLE_ORDER.indexOf(prev) + 1) % CYCLE_ORDER.length]);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, cycleTheme }),
    [theme, resolvedTheme, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  return ctx;
}
