import { describe, expect, test } from "vitest";
import { en } from "../src/i18n/en";
import { es419 } from "../src/i18n/es-419";
import { ptBR } from "../src/i18n/pt-BR";
import { LOCALES, matchLocale, preferredLocale, translate, translatePlural } from "../src/i18n/translate";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("dashboard translations", () => {
  test.each([
    ["es-419", es419],
    ["pt-BR", ptBR],
  ])("%s translates every key with the same placeholders", (_locale, translations) => {
    expect(Object.keys(translations).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(translations[key as keyof typeof en]), key).toEqual(placeholders(text));
      expect(translations[key as keyof typeof en].trim(), key).not.toBe("");
    }
  });

  test("Latin American Spanish never uses voseo", () => {
    const voseo = /\b(?:tenés|podés|querés|sabés|hacé|elegí|escribí|agregá|probá|vos)\b/i;
    for (const text of Object.values(es419)) expect(text).not.toMatch(voseo);
  });

  test("fills placeholders and leaves unknown ones", () => {
    expect(translate("en", "toast.newMail", { sender: "Ana" })).toBe("New email from Ana");
    expect(translate("en", "toast.newMail")).toBe("New email from {sender}");
  });

  test.each([
    ["en", 1, "1 message"],
    ["en", 3, "3 messages"],
    ["es-419", 1, "1 mensaje"],
    ["es-419", 0, "0 mensajes"],
    ["pt-BR", 1, "1 mensagem"],
  ] as const)("pluralizes in %s for %d", (locale, count, expected) => {
    expect(translatePlural(locale, "list.count", count)).toBe(expected);
  });

  test.each([
    ["es-CL", "es-419"],
    ["es", "es-419"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["en-US", "en"],
    ["es-419", "es-419"],
    ["fr", null],
    ["", null],
    [null, null],
  ])("matches %s to %s", (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });

  test("picks the first supported browser language", () => {
    expect(preferredLocale(["fr-FR", "pt-BR", "en"])).toBe("pt-BR");
    expect(preferredLocale(["de"])).toBe("en");
    expect(LOCALES).toEqual(["en", "es-419", "pt-BR"]);
  });
});
