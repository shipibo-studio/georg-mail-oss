import { isSwipe } from "@shipibo-studio/georg-ds/georg-motion.mjs";
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

/** Swiping a message to the right goes back to the list (georg-ds's thresholds: far enough, or a fast flick). */
export function isSwipeBack(offsetX: number, velocityX: number): boolean {
  return isSwipe(offsetX, velocityX);
}

/** Swiping a sheet down closes it. */
export function isSwipeDown(offsetY: number, velocityY: number): boolean {
  return isSwipe(offsetY, velocityY);
}
