import { useSyncExternalStore } from 'react';

/** Two looks only: light (the default) and dark. The choice is kept per device. */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'tb.theme';
/** Browser bar / phone status bar colour for each look (matches --c-app). */
const BAR: Record<Theme, string> = { light: '#F0F5F3', dark: '#0E1412' };

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the choice lasts until the tab closes */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, getTheme, () => 'light' as Theme), setTheme];
}
