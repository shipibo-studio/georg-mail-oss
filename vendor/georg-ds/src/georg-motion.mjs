/*
 * georg design system · motion values for JavaScript
 *
 * The same curves and durations as the --ease-* and --dur-* tokens in georg.css, plus the named springs
 * and swipe thresholds georg-mail ships, so React code imports them instead of repeating numbers.
 * Shaped for Motion (motion.dev): durations in seconds, easings as cubic-bezier control points and springs
 * ready for a transition prop.
 *   import { SPRING, DURATION, EASE_OUT } from "@shipibo-studio/georg-ds/georg-motion.mjs";
 *   <motion.div layoutId="selection" transition={SPRING.selection} />
 *   <motion.div exit={{ opacity: 0, transition: { duration: DURATION.exit, ease: EASE_OUT } }} />
 * Plain data and one pure function: no side effects, nothing runs on import. The full spec lives in
 * docs/motion.md.
 */

/** Freezes nested objects too, so a consumer cannot change the shared values by accident. */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}

const spring = (stiffness, damping) => ({ type: "spring", stiffness, damping });

/** --ease-out: entrances, movement and every exit. */
export const EASE_OUT = deepFreeze([0.22, 1, 0.36, 1]);

/** --ease-spring: confirmations with a slight overshoot, for CSS-like tweens that cannot use a spring. */
export const EASE_SPRING = deepFreeze([0.34, 1.56, 0.64, 1]);

/** In seconds, the unit Motion expects. Each one mirrors a --dur-* token. */
export const DURATION = deepFreeze({
  /** --dur-1: hover and color changes. */
  hover: 0.15,
  /** --dur-2: opacity and appearance. */
  appear: 0.22,
  /** --dur-3: movement and sliding indicators. */
  move: 0.32,
  /** --dur-exit: leaving is always faster than arriving. */
  exit: 0.14,
});

/** The named springs. A new animation picks the closest one instead of inventing its own numbers. */
export const SPRING = deepFreeze({
  /** layoutId highlights that slide between items: rows, tabs. */
  selection: spring(500, 40),
  /** Sidebar and phone tab-bar highlights. */
  nav: spring(500, 38),
  /** Popovers, menus, the command palette and segmented thumbs (scale .98 → 1, y -6 → 0). */
  overlay: spring(520, 34),
  /** Dialogs and bottom sheets. */
  sheet: spring(420, 32),
  /** Inline panels that open inside a view: forms, the composer. */
  panel: spring(380, 30),
  /** The highlight that follows the keyboard in long lists, like palette results. */
  list: spring(700, 45),
  /** Chips joining or leaving a row (attached files). */
  chip: spring(600, 32),
  /** Badges and counters appearing. */
  pop: spring(500, 22),
  /** Empty-state icons settling in: the one spring allowed to wobble. */
  playful: spring(260, 14),
  /** Progress bars: slow and smooth, so the fill never jumps. */
  progress: spring(140, 26),
});

/** Swipe gestures on touch screens: going back on x, closing a sheet on y. */
export const GESTURE = deepFreeze({
  /** A slow drag counts once it travels this far. */
  swipeDistancePx: 90,
  /** A short flick counts from this distance… */
  flickDistancePx: 24,
  /** …when it is at least this fast. */
  flickVelocityPxPerS: 500,
  /** Drag elasticity (Motion's dragElastic) for the back swipe and for dragging a sheet down. */
  backElastic: 0.6,
  sheetElastic: 0.7,
});

/** Whether a drag (offset in px and velocity in px/s along the swipe direction) should complete the gesture. */
export function isSwipe(offset, velocity) {
  if (!Number.isFinite(offset) || !Number.isFinite(velocity)) return false;
  return (
    offset > GESTURE.swipeDistancePx ||
    (offset > GESTURE.flickDistancePx && velocity > GESTURE.flickVelocityPxPerS)
  );
}
