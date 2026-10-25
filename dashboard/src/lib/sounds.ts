// Interface sounds: short cues for presses, switches and events (mail sent, new mail, an error).
// Synthesized with the Web Audio API from the recipes below, so there are no audio files to load,
// nothing crosses the Content-Security-Policy and the sounds are ours to publish under MIT.
// Quiet on purpose, never the only feedback (every cue has a visible counterpart), and off with one
// switch in Settings, kept with the other display preferences.
import { useSyncExternalStore } from "react";

export const SOUND_SETTINGS = ["on", "off"] as const;
export type SoundSetting = (typeof SOUND_SETTINGS)[number];
export const DEFAULT_SOUND_SETTING: SoundSetting = "on";
const STORAGE_KEY = "georg-mail.sounds";

interface Tone {
  wave: OscillatorType;
  /** Hz at the start; `to` glides to another pitch over the tone. */
  from: number;
  to?: number;
  /** Seconds after the sound starts. */
  at: number;
  duration: number;
  /** Relative to the master volume, 0 to 1. */
  gain: number;
}

/** Every sound the interface makes, as tones. Short (under 0.4 s) and soft (master volume below). */
export const SOUND_RECIPES = {
  /** Any button. */
  tap: [{ wave: "triangle", from: 1250, to: 900, at: 0, duration: 0.045, gain: 0.5 }],
  /** A primary button: lower and fuller. */
  press: [
    { wave: "sine", from: 520, to: 430, at: 0, duration: 0.07, gain: 0.6 },
    { wave: "triangle", from: 1560, to: 1300, at: 0, duration: 0.03, gain: 0.18 },
  ],
  /** Moving between places: folders, messages, tabs, options. */
  tick: [{ wave: "triangle", from: 2100, to: 1900, at: 0, duration: 0.025, gain: 0.28 }],
  toggleOn: [
    { wave: "sine", from: 660, at: 0, duration: 0.05, gain: 0.4 },
    { wave: "sine", from: 990, at: 0.045, duration: 0.07, gain: 0.4 },
  ],
  toggleOff: [
    { wave: "sine", from: 990, at: 0, duration: 0.05, gain: 0.35 },
    { wave: "sine", from: 660, at: 0.045, duration: 0.07, gain: 0.35 },
  ],
  copy: [
    { wave: "sine", from: 1320, at: 0, duration: 0.05, gain: 0.32 },
    { wave: "sine", from: 1760, at: 0.05, duration: 0.08, gain: 0.28 },
  ],
  /** A message leaves: a quick rising glide. */
  send: [
    { wave: "sine", from: 520, to: 1040, at: 0, duration: 0.16, gain: 0.4 },
    { wave: "triangle", from: 1560, to: 2080, at: 0.06, duration: 0.12, gain: 0.12 },
  ],
  /** New mail: a soft two-note chime. */
  arrive: [
    { wave: "sine", from: 880, at: 0, duration: 0.18, gain: 0.34 },
    { wave: "sine", from: 1318.5, at: 0.11, duration: 0.28, gain: 0.3 },
  ],
  /** Archive, Trash or Spam: the message slides away. */
  move: [{ wave: "triangle", from: 700, to: 420, at: 0, duration: 0.1, gain: 0.4 }],
  /** Something deleted for good after a press and hold. */
  remove: [{ wave: "sine", from: 180, to: 90, at: 0, duration: 0.14, gain: 0.7 }],
  /** A long task done (an import, an update): a rising major arpeggio. */
  success: [
    { wave: "sine", from: 784, at: 0, duration: 0.12, gain: 0.3 },
    { wave: "sine", from: 988, at: 0.08, duration: 0.14, gain: 0.3 },
    { wave: "sine", from: 1175, at: 0.16, duration: 0.24, gain: 0.3 },
  ],
  /** Done, but not all of it. */
  warn: [
    { wave: "triangle", from: 660, at: 0, duration: 0.12, gain: 0.35 },
    { wave: "triangle", from: 554, at: 0.11, duration: 0.18, gain: 0.35 },
  ],
  error: [
    { wave: "triangle", from: 330, at: 0, duration: 0.12, gain: 0.45 },
    { wave: "triangle", from: 247, at: 0.1, duration: 0.2, gain: 0.45 },
  ],
} as const satisfies Record<string, readonly Tone[]>;

export type Sound = keyof typeof SOUND_RECIPES;

/** Loud enough to notice in a quiet room, never over music. */
const MASTER_VOLUME = 0.16;
const ATTACK_S = 0.004;
const SILENCE = 0.0001;
/** The same sound twice within this window (a double click, a batch) plays once. */
const REPEAT_WINDOW_MS = 60;
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

function schedule(audio: AudioContext, tones: readonly Tone[]) {
  const start = audio.currentTime;
  const master = audio.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(audio.destination);
  for (const tone of tones) {
    const begin = start + tone.at;
    const end = begin + tone.duration;
    const oscillator = audio.createOscillator();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.from, begin);
    if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(SILENCE, begin);
    envelope.gain.linearRampToValueAtTime(tone.gain, begin + ATTACK_S);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);
    oscillator.connect(envelope).connect(master);
    oscillator.start(begin);
    oscillator.stop(end + ATTACK_S);
  }
}

/** Plays a sound unless sounds are off; returns whether it was played. */
export function play(sound: Sound, now = performance.now()): boolean {
  if (setting === "off") return false;
  const last = lastPlayed.get(sound);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  lastPlayed.set(sound, now);
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: sound }));
  const audio = audioContext();
  if (!audio) return true;
  // Suspended until a gesture; a sound without one (new mail on an untouched tab) stays silent.
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  try {
    schedule(audio, SOUND_RECIPES[sound]);
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
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
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
