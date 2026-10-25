/*
 * georg design system · interface sounds
 *
 * Short cues for presses, switches and events (sent, arrived, failed), synthesized with the Web Audio API
 * from the recipes below. There are no audio files to load, nothing for a Content-Security-Policy to
 * allow, and the sounds are ours to publish under MIT. The recipes come from georg-mail.
 *   import { scheduleSound } from "@shipibo-studio/georg-ds/georg-sounds.mjs";
 *   scheduleSound(audioContext, "send");
 * This module only makes the sound. The app keeps the rest, as docs/motion.md describes:
 *   - an "Interface sounds" setting;
 *   - creating the AudioContext after a user gesture;
 *   - skipping repeats within SOUND_MIX.repeatWindowMs;
 *   - a visible counterpart for every sound.
 * Nothing runs on import.
 */

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}

/** Loud enough to notice in a quiet room, never over music; tones fade in over attackS to avoid clicks. */
export const SOUND_MIX = deepFreeze({
  masterVolume: 0.16,
  attackS: 0.004,
  /** The same sound twice within this window (a double click, a batch) should play once. */
  repeatWindowMs: 60,
});

/** Exponential ramps cannot reach zero; this is inaudible. */
const SILENCE = 0.0001;

/**
 * Every sound as a list of tones: wave, pitch in Hz (from, optionally gliding to `to`), start `at` and
 * `duration` in seconds, and gain relative to the master volume. None lasts more than 0.4 s.
 */
export const SOUND_RECIPES = deepFreeze({
  /** Any button. */
  tap: [{ wave: "triangle", from: 1250, to: 900, at: 0, duration: 0.045, gain: 0.5 }],
  /** A primary button: lower and fuller. */
  press: [
    { wave: "sine", from: 520, to: 430, at: 0, duration: 0.07, gain: 0.6 },
    { wave: "triangle", from: 1560, to: 1300, at: 0, duration: 0.03, gain: 0.18 },
  ],
  /** Moving between places: folders, rows, tabs, radios, options. */
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
  /** Something leaves: a quick rising glide. */
  send: [
    { wave: "sine", from: 520, to: 1040, at: 0, duration: 0.16, gain: 0.4 },
    { wave: "triangle", from: 1560, to: 2080, at: 0.06, duration: 0.12, gain: 0.12 },
  ],
  /** Something new arrived: a soft two-note chime. */
  arrive: [
    { wave: "sine", from: 880, at: 0, duration: 0.18, gain: 0.34 },
    { wave: "sine", from: 1318.5, at: 0.11, duration: 0.28, gain: 0.3 },
  ],
  /** An item slides away: archive, trash, spam. */
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
});

export const SOUND_NAMES = deepFreeze(Object.keys(SOUND_RECIPES));

/** Own keys only, so "constructor" or "__proto__" never reach the recipes' prototype. */
function recipeFor(name) {
  return typeof name === "string" && Object.hasOwn(SOUND_RECIPES, name) ? SOUND_RECIPES[name] : null;
}

/** Seconds from the start of a sound to the end of its last tone; 0 for an unknown name. */
export function soundDuration(name) {
  const tones = recipeFor(name);
  return tones ? Math.max(...tones.map((tone) => tone.at + tone.duration)) : 0;
}

/**
 * Schedules a sound on an AudioContext (or an OfflineAudioContext) starting now. Returns its length in
 * seconds, or 0 when the name is unknown and nothing was scheduled.
 */
export function scheduleSound(audio, name, { volume = SOUND_MIX.masterVolume, destination = audio.destination } = {}) {
  const tones = recipeFor(name);
  if (!tones) return 0;
  const start = audio.currentTime;
  const master = audio.createGain();
  master.gain.value = volume;
  master.connect(destination);
  for (const tone of tones) {
    const begin = start + tone.at;
    const end = begin + tone.duration;
    const oscillator = audio.createOscillator();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.from, begin);
    if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(SILENCE, begin);
    envelope.gain.linearRampToValueAtTime(tone.gain, begin + SOUND_MIX.attackS);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);
    oscillator.connect(envelope).connect(master);
    oscillator.start(begin);
    oscillator.stop(end + SOUND_MIX.attackS);
  }
  return soundDuration(name);
}
