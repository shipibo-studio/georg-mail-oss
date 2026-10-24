import { useSyncExternalStore } from "react";

/** Phones: one column, bottom navigation, sheets instead of floating panels (see styles.css). */
export const PHONE_QUERY = "(max-width: 760px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

const SWIPE_DISTANCE_PX = 90;
const SWIPE_MIN_FLICK_PX = 24;
const SWIPE_VELOCITY_PX_PER_S = 500;

/** A swipe far enough, or a short flick fast enough, along one axis. */
function isSwipe(offset: number, velocity: number): boolean {
  return offset > SWIPE_DISTANCE_PX || (offset > SWIPE_MIN_FLICK_PX && velocity > SWIPE_VELOCITY_PX_PER_S);
}

/** Swiping a message to the right goes back to the list. */
export function isSwipeBack(offsetX: number, velocityX: number): boolean {
  return isSwipe(offsetX, velocityX);
}

/** Swiping a sheet down closes it. */
export function isSwipeDown(offsetY: number, velocityY: number): boolean {
  return isSwipe(offsetY, velocityY);
}
