// What a preferences save sends: only what differs from the last saved copy.
import { afterEach, describe, expect, test } from "vitest";
import { changedPreferences, isEmpty, readSynced, unsyncedChanges, writeSynced } from "../src/lib/preferences";

const CURRENT = {
  theme: "dark",
  accent: "green",
  locale: "es-419",
  clock: "12h",
  avatars: "initials",
  sounds: "off",
} as const;

describe("preference changes", () => {
  test("everything, when nothing was saved yet", () => {
    expect(changedPreferences({}, CURRENT)).toEqual(CURRENT);
  });

  test("only what differs from the saved copy", () => {
    expect(changedPreferences({ ...CURRENT, locale: "en", avatars: "faces" }, CURRENT)).toEqual({
      locale: "es-419",
      avatars: "initials",
    });
  });

  test("nothing, when they match", () => {
    expect(isEmpty(changedPreferences({ ...CURRENT }, CURRENT))).toBe(true);
    expect(isEmpty({ theme: "light" })).toBe(false);
  });
});

describe("changes this browser never saved", () => {
  afterEach(() => localStorage.clear());

  test("are what changed since the last sync", () => {
    expect(unsyncedChanges({ ...CURRENT, clock: "24h" }, CURRENT)).toEqual({ clock: "12h" });
    expect(isEmpty(unsyncedChanges({ ...CURRENT }, CURRENT))).toBe(true);
  });

  test("are none in a browser that never synced: the Worker's copy wins", () => {
    expect(unsyncedChanges(null, CURRENT)).toEqual({});
  });

  test("the last sync survives a reload, and a damaged copy counts as none", () => {
    expect(readSynced()).toBeNull();
    writeSynced({ clock: "12h" });
    expect(readSynced()).toEqual({ clock: "12h" });
    for (const damaged of ["{", "[1]", "42", "null"]) {
      localStorage.setItem("georg-mail.preferences-synced", damaged);
      expect(readSynced()).toBeNull();
    }
  });
});
