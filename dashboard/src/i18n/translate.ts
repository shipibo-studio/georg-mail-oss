import { en, type MessageKey, type Translations } from "./en";
import { es419 } from "./es-419";
import { ptBR } from "./pt-BR";

export const LOCALES = ["en", "es-419", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
export type { MessageKey };

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", "es-419": "Español", "pt-BR": "Português" };

const TRANSLATIONS: Record<Locale, Translations> = { en, "es-419": es419, "pt-BR": ptBR };
type Values = Record<string, string | number>;

/** A translated string with its {placeholders} filled in. Unknown placeholders are left as they are. */
export function translate(locale: Locale, key: MessageKey, values: Values = {}): string {
  return TRANSLATIONS[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}

type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

/** The ".one" or ".other" form of a key, chosen by the locale's plural rules. */
export function translatePlural(locale: Locale, base: PluralBase, count: number, values: Values = {}): string {
  const form = new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
  return translate(locale, `${base}.${form}` as MessageKey, { count, ...values });
}

/** Maps a language tag ("es-CL", "pt", "en-US") to a supported locale, if any. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (tag && (LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  const language = tag?.trim().toLowerCase().split("-")[0];
  if (language === "es") return "es-419";
  if (language === "pt") return "pt-BR";
  if (language === "en") return "en";
  return null;
}

/** The first supported language among the browser's preferences, or English. */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const locale = matchLocale(language);
    if (locale) return locale;
  }
  return "en";
}
