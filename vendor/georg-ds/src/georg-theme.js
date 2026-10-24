/*
 * georg design system · theme and accent controller
 *
 * Load it in <head> WITHOUT defer or async, after georg.css:
 *   <script src="georg-theme.js"></script>
 * The theme is resolved before first paint, so there is no flash of the wrong theme.
 *
 * Global API: window.georgTheme
 *   georgTheme.get()               → { pref, theme, accent } (the latest request, even mid-transition)
 *   georgTheme.setTheme(pref)      → "system" | "light" | "dark"
 *   georgTheme.setAccent(name)     → "purple" | "fuchsia" | "green" | "blue" | "orange"
 *   georgTheme.onChange(listener)  → listener({ pref, theme, accent }); returns an unsubscribe function
 *   georgTheme.ACCENTS             → { purple: { name, swatch }, … }
 *   georgTheme.PREFS               → ["system", "light", "dark"]
 */
(() => {
  const THEME_STORAGE_KEY = "georg-theme";
  const ACCENT_STORAGE_KEY = "georg-accent";
  const DEFAULT_PREF = "system";
  const DEFAULT_ACCENT = "purple";
  const PREFS = ["system", "light", "dark"];
  const ACCENTS = {
    purple: { name: "Purple", swatch: "#8f00f5" },
    fuchsia: { name: "Fuchsia", swatch: "#c40062" },
    green: { name: "Green", swatch: "#007527" },
    blue: { name: "Blue", swatch: "#005edb" },
    orange: { name: "Orange", swatch: "#b04000" },
  };
  const ACCENT_KEYS = Object.keys(ACCENTS);

  const root = document.documentElement;
  const prefersDark = matchMedia("(prefers-color-scheme: dark)");
  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new Set();
  // The requested appearance. <html> only catches up when a view transition runs its callback (a later
  // frame), so reading the state back from root.dataset in the meantime would undo a choice just made.
  const requested = { pref: DEFAULT_PREF, accent: DEFAULT_ACCENT };

  // localStorage can throw (strict private mode, sandboxed iframes); theming still works without persistence.
  function readStored(key, fallback, allowedValues) {
    try {
      const value = localStorage.getItem(key);
      return allowedValues.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Persistence is best effort.
    }
  }

  function resolveTheme(pref) {
    const isDark = pref === "dark" || (pref === "system" && prefersDark.matches);
    return isDark ? "dark" : "light";
  }

  function getState() {
    return { pref: requested.pref, theme: resolveTheme(requested.pref), accent: requested.accent };
  }

  function notifyListeners() {
    const state = getState();
    listeners.forEach((listener) => listener(state));
  }

  // Cross-fade between states when supported, unless the user asked for reduced motion.
  function runWithTransition(update) {
    const canAnimate =
      typeof document.startViewTransition === "function" &&
      !prefersReducedMotion.matches &&
      document.visibilityState === "visible";
    if (canAnimate) document.startViewTransition(update);
    else update();
  }

  // Writes the latest request, not the values captured when the transition started: a callback that runs
  // late after a newer request still leaves <html> in the newest state.
  function writeRequestedToRoot() {
    const { pref, theme, accent } = getState();
    root.dataset.theme = theme;
    root.dataset.themePref = pref;
    root.dataset.accent = accent;
    notifyListeners();
  }

  function applyAppearance(pref, accent, { animate }) {
    const hasVisualChange = root.dataset.theme !== resolveTheme(pref) || root.dataset.accent !== accent;
    requested.pref = pref;
    requested.accent = accent;
    if (animate && hasVisualChange) runWithTransition(writeRequestedToRoot);
    else writeRequestedToRoot();
  }

  function readStoredAppearance() {
    return {
      pref: readStored(THEME_STORAGE_KEY, DEFAULT_PREF, PREFS),
      accent: readStored(ACCENT_STORAGE_KEY, DEFAULT_ACCENT, ACCENT_KEYS),
    };
  }

  // Apply immediately, before first paint.
  const initial = readStoredAppearance();
  applyAppearance(initial.pref, initial.accent, { animate: false });

  // With the "system" preference, follow OS changes live.
  prefersDark.addEventListener("change", () => {
    if (requested.pref === "system") applyAppearance("system", requested.accent, { animate: true });
  });

  // Keep open tabs in sync.
  addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== ACCENT_STORAGE_KEY) return;
    const stored = readStoredAppearance();
    applyAppearance(stored.pref, stored.accent, { animate: true });
  });

  window.georgTheme = {
    ACCENTS,
    PREFS,
    get: getState,
    setTheme(pref) {
      if (!PREFS.includes(pref)) throw new Error(`Unknown theme preference: ${pref}`);
      writeStored(THEME_STORAGE_KEY, pref);
      applyAppearance(pref, requested.accent, { animate: true });
    },
    setAccent(accent) {
      // An own-key check: ACCENTS[accent] would accept inherited keys such as "constructor".
      if (!ACCENT_KEYS.includes(accent)) throw new Error(`Unknown accent: ${accent}`);
      writeStored(ACCENT_STORAGE_KEY, accent);
      applyAppearance(requested.pref, accent, { animate: true });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
