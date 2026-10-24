// window.georgTheme comes from georg-theme.js (georg-ds), loaded before the app so the theme is
// applied before the first paint. This hook keeps React in sync with it.
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type AccentName = "purple" | "fuchsia" | "green" | "blue" | "orange";

interface ThemeState {
  pref: ThemePref;
  theme: "light" | "dark";
  accent: AccentName;
}

interface GeorgTheme {
  get(): ThemeState;
  setTheme(pref: ThemePref): void;
  setAccent(accent: AccentName): void;
  onChange(listener: (state: ThemeState) => void): () => void;
  ACCENTS: Record<AccentName, { name: string; swatch: string }>;
  PREFS: ThemePref[];
}

declare global {
  interface Window {
    georgTheme: GeorgTheme;
  }
}

export const georgTheme = (): GeorgTheme => window.georgTheme;

let cached: ThemeState | null = null;

function snapshot(): ThemeState {
  const next = window.georgTheme.get();
  if (!cached || cached.pref !== next.pref || cached.theme !== next.theme || cached.accent !== next.accent) {
    cached = next;
  }
  return cached;
}

export function useGeorgTheme(): ThemeState {
  return useSyncExternalStore((onChange) => window.georgTheme.onChange(onChange), snapshot);
}
