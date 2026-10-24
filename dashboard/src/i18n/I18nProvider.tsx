import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CLOCKS, type Clock, DEFAULT_CLOCK } from "../lib/format";
import { type Locale, type MessageKey, matchLocale, preferredLocale, translate, translatePlural } from "./translate";

const STORAGE_KEY = "georg-mail-locale";
const CLOCK_STORAGE_KEY = "georg-mail-clock";

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  /** 24-hour or 12-hour times, chosen in Settings; 24-hour unless changed. */
  clock: Clock;
  setClock(clock: Clock): void;
  t(key: MessageKey, values?: Record<string, string | number>): string;
  plural: (
    base: Parameters<typeof translatePlural>[1],
    count: number,
    values?: Record<string, string | number>,
  ) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    return matchLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function readStoredClock(): Clock {
  try {
    const stored = localStorage.getItem(CLOCK_STORAGE_KEY);
    return CLOCKS.find((clock) => clock === stored) ?? DEFAULT_CLOCK;
  } catch {
    return DEFAULT_CLOCK;
  }
}

/** Private mode or blocked storage: the choice lasts for this visit only. */
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the in-memory state still holds the choice.
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? preferredLocale(navigator.languages));
  const [clock, setClockState] = useState<Clock>(readStoredClock);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    store(STORAGE_KEY, next);
  }, []);
  const setClock = useCallback((next: Clock) => {
    setClockState(next);
    store(CLOCK_STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      clock,
      setClock,
      t: (key, values) => translate(locale, key, values),
      plural: (base, count, values) => translatePlural(locale, base, count, values),
    }),
    [clock, locale, setClock, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
