// Interface sounds: short cues for presses, switches and events (mail sent, new mail, an error).
// The recipes and the synthesis are georg-ds's (georg-sounds.mjs, from georg-mail's own): Web Audio
// tones, so there are no audio files to load and nothing crosses the Content-Security-Policy. This
// module keeps what is the app's: the setting, the repeat window, and which sound a click makes.
// Quiet on purpose, never the only feedback (every cue has a visible counterpart), and off with one
// switch in Settings, kept with the other display preferences.
import { SOUND_MIX, SOUND_RECIPES, scheduleSound } from "@shipibo-studio/georg-ds/georg-sounds.mjs";
import { useSyncExternalStore } from "react";

export const SOUND_SETTINGS = ["on", "off"] as const;
export type SoundSetting = (typeof SOUND_SETTINGS)[number];
export const DEFAULT_SOUND_SETTING: SoundSetting = "on";
const STORAGE_KEY = "georg-mail.sounds";

export { SOUND_RECIPES };
export type Sound = keyof typeof SOUND_RECIPES;

/** Every played sound is announced on window, for tests; nothing listens in production. */
export const SOUND_EVENT = "georg:sound";

// ── The preference ──────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let setting: SoundSetting = readStored();

function readStored(): SoundSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SOUND_SETTINGS.find((value) => value === stored) ?? DEFAULT_SOUND_SETTING;
  } catch {
    return DEFAULT_SOUND_SETTING;
  }
}

export function getSounds(): SoundSetting {
  return setting;
}

export function setSounds(next: SoundSetting): void {
  setting = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSounds(): SoundSetting {
  return useSyncExternalStore(subscribe, getSounds, getSounds);
}

// ── Playing ─────────────────────────────────────────────────────────────────

let context: AudioContext | null = null;
const lastPlayed = new Map<Sound, number>();

/** Created on first use: browsers only let audio start after the person interacts with the page. */
function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof AudioContext === "undefined") return null;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  return context;
}

/** Plays a sound unless sounds are off; returns whether it was played. */
export function play(sound: Sound, now = performance.now()): boolean {
  if (setting === "off") return false;
  const last = lastPlayed.get(sound);
  if (last !== undefined && now - last < SOUND_MIX.repeatWindowMs) return false;
  lastPlayed.set(sound, now);
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: sound }));
  const audio = audioContext();
  if (!audio) return true;
  // Suspended until a gesture; a sound without one (new mail on an untouched tab) stays silent.
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  try {
    scheduleSound(audio, sound);
  } catch {
    // An audio device that went away: the interface works the same without the sound.
  }
  return true;
}

// ── Which sound a click makes ───────────────────────────────────────────────

const CLICKABLE =
  'button, a.g-button, input[type="checkbox"], input[type="radio"], select, [role="radio"], [role="tab"], [role="option"], [role="menuitem"]';
const MOVING = ".folder, .mobile-tab, button.msg, .palette-item, .g-tab, .tab";

/**
 * The sound a click on `target` makes, or null. A control can choose its own with data-sound
 * (a sound name, or "none" when it plays an event sound of its own, like Copy or a hold button).
 */
export function soundForClick(target: Element): Sound | null {
  const control = target.closest(CLICKABLE);
  // A busy button ignores presses (georg-ds's busy state), so it makes no sound either.
  if (!control || control.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')) return null;
  const chosen = control.getAttribute("data-sound");
  if (chosen) return chosen in SOUND_RECIPES ? (chosen as Sound) : null;
  // A select sounds when an option is chosen, not when it opens.
  if (control.matches("select")) return null;
  if (control.matches('input[type="checkbox"]'))
    return (control as HTMLInputElement).checked ? "toggleOn" : "toggleOff";
  if (control.matches('input[type="radio"], [role="radio"], [role="tab"], [role="option"], [role="menuitem"]')) {
    return "tick";
  }
  if (control.matches(MOVING)) return "tick";
  if (control.matches(".g-button-primary")) return "press";
  return "tap";
}

/** One listener for the whole page: every press sounds, without wiring each button. */
export function installClickSounds(root: Document = document): () => void {
  const onClick = (event: Event) => {
    if (event.target instanceof Element) {
      const sound = soundForClick(event.target);
      if (sound) play(sound);
    }
  };
  const onChange = (event: Event) => {
    if (event.target instanceof HTMLSelectElement) play("tick");
  };
  root.addEventListener("click", onClick, true);
  root.addEventListener("change", onChange, true);
  return () => {
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("change", onChange, true);
  };
}
