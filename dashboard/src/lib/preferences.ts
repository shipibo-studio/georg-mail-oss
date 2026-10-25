// Display preferences as the Worker keeps them (D1, per person) and the browser caches them
// (localStorage, for the first paint). Pure helpers; components/PreferenceSync.tsx does the syncing.
import type { Locale } from "../i18n/translate";
import type { AvatarStyle } from "./avatar-style";
import type { Clock } from "./format";
import type { SoundSetting } from "./sounds";
import type { AccentName, ThemePref } from "./theme";

export interface Preferences {
  theme?: ThemePref;
  accent?: AccentName;
  locale?: Locale;
  clock?: Clock;
  avatars?: AvatarStyle;
  sounds?: SoundSetting;
}

export type CurrentPreferences = Required<Preferences>;

const KEYS = ["theme", "accent", "locale", "clock", "avatars", "sounds"] as const;

/** The preferences that differ from what was last saved: what a save needs to send. */
export function changedPreferences(saved: Preferences, current: CurrentPreferences): Preferences {
  const changes: Preferences = {};
  for (const key of KEYS) {
    if (saved[key] !== current[key]) Object.assign(changes, { [key]: current[key] });
  }
  return changes;
}

export function isEmpty(preferences: Preferences): boolean {
  return Object.keys(preferences).length === 0;
}

const SYNCED_KEY = "georg-mail.preferences-synced";

/** What this browser last knew the Worker to have saved; null when it never synced. */
export function readSynced(): Preferences | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Preferences) : null;
  } catch {
    return null;
  }
}

export function writeSynced(preferences: Preferences): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode or blocked storage: the next load trusts the Worker's copy.
  }
}

/**
 * Changes made in this browser that never reached the Worker: a reload within the save delay, or a
 * failed save. They win over the Worker's copy on the next load. A browser that never synced has
 * none: its cache is older than anything saved.
 */
export function unsyncedChanges(synced: Preferences | null, current: CurrentPreferences): Preferences {
  return synced ? changedPreferences(synced, current) : {};
}
