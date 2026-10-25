// Types for georg-ds's plain JavaScript modules, which ship without declarations (georg-ds docs/motion.md).
declare module "@shipibo-studio/georg-ds/georg-motion.mjs" {
  interface Spring {
    readonly type: "spring";
    readonly stiffness: number;
    readonly damping: number;
  }
  type SpringName =
    | "selection"
    | "nav"
    | "overlay"
    | "sheet"
    | "panel"
    | "list"
    | "chip"
    | "pop"
    | "playful"
    | "progress";
  export const EASE_OUT: readonly [number, number, number, number];
  export const EASE_SPRING: readonly [number, number, number, number];
  export const DURATION: {
    readonly hover: number;
    readonly appear: number;
    readonly move: number;
    readonly exit: number;
  };
  export const SPRING: { readonly [Name in SpringName]: Spring };
  export const GESTURE: {
    readonly swipeDistancePx: number;
    readonly flickDistancePx: number;
    readonly flickVelocityPxPerS: number;
    readonly backElastic: number;
    readonly sheetElastic: number;
  };
  export function isSwipe(offset: number, velocity: number): boolean;
}

declare module "@shipibo-studio/georg-ds/georg-sounds.mjs" {
  type SoundName =
    | "tap"
    | "press"
    | "tick"
    | "toggleOn"
    | "toggleOff"
    | "copy"
    | "send"
    | "arrive"
    | "move"
    | "remove"
    | "success"
    | "warn"
    | "error";
  interface Tone {
    readonly wave: OscillatorType;
    readonly from: number;
    readonly to?: number;
    readonly at: number;
    readonly duration: number;
    readonly gain: number;
  }
  export const SOUND_MIX: { readonly masterVolume: number; readonly attackS: number; readonly repeatWindowMs: number };
  export const SOUND_RECIPES: { readonly [Name in SoundName]: readonly Tone[] };
  export const SOUND_NAMES: readonly SoundName[];
  export function soundDuration(name: string): number;
  export function scheduleSound(
    audio: BaseAudioContext,
    name: string,
    options?: { volume?: number; destination?: AudioNode },
  ): number;
}
