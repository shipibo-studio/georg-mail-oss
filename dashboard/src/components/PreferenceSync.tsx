// Keeps the display preferences the same on every device. When the mailbox first loads, what the
// Worker saved wins over this browser's copy, except changes this browser made and never got to
// save; from then on, every change here is saved there a moment later. The browser's own copy
// (localStorage) stays as the cache for the next first paint.
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { setAvatarStyle, useAvatarStyle } from "../lib/avatar-style";
import {
  changedPreferences,
  isEmpty,
  type Preferences,
  readSynced,
  unsyncedChanges,
  writeSynced,
} from "../lib/preferences";
import { georgTheme, useGeorgTheme } from "../lib/theme";

/** Rapid changes (clicking through accents) become one save. */
const SAVE_DELAY_MS = 500;

export function PreferenceSync({ saved }: { saved: Preferences | null | undefined }) {
  const { pref: theme, accent } = useGeorgTheme();
  const { locale, setLocale, clock, setClock } = useI18n();
  const avatars = useAvatarStyle();
  const loaded = useRef(false);
  const lastSaved = useRef<Preferences>({});

  /** A failed save is tried again with the next change. */
  const save = (changes: Preferences) =>
    api
      .savePreferences(changes)
      .then((stored) => {
        lastSaved.current = stored;
        writeSynced(stored);
      })
      .catch(() => {});

  // The first answer from the Worker: its saved preferences replace this browser's, but for changes
  // made here that never reached it. With none saved yet, this browser's become the saved ones.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the saved preferences arrive
  useEffect(() => {
    if (saved === undefined || loaded.current) return;
    loaded.current = true;
    const current = { theme, accent, locale, clock, avatars };
    if (!saved) {
      save(current);
      return;
    }
    const unsynced = unsyncedChanges(readSynced(), current);
    const wanted = { ...saved, ...unsynced };
    if (wanted.theme && wanted.theme !== theme) georgTheme().setTheme(wanted.theme);
    if (wanted.accent && wanted.accent !== accent) georgTheme().setAccent(wanted.accent);
    if (wanted.locale && wanted.locale !== locale) setLocale(wanted.locale);
    if (wanted.clock && wanted.clock !== clock) setClock(wanted.clock);
    if (wanted.avatars && wanted.avatars !== avatars) setAvatarStyle(wanted.avatars);
    // Counted as saved, so the change effect does not send them again a moment later.
    lastSaved.current = wanted;
    if (isEmpty(unsynced)) writeSynced(saved);
    else save(unsynced);
  }, [saved]);

  // Every later change, saved a moment after the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: save only reads refs
  useEffect(() => {
    if (!loaded.current) return;
    const changes = changedPreferences(lastSaved.current, { theme, accent, locale, clock, avatars });
    if (isEmpty(changes)) return;
    const timer = setTimeout(() => save(changes), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [theme, accent, locale, clock, avatars]);

  return null;
}
