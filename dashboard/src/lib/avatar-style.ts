// How senders are drawn: DiceBear faces (the default) or the initials tinted per sender. A choice of
// this browser, kept in localStorage like the language and the time format, and shared by every
// avatar on screen so a change shows at once.
import { useSyncExternalStore } from "react";

export const AVATAR_STYLES = ["faces", "initials"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
export const DEFAULT_AVATAR_STYLE: AvatarStyle = "faces";
const STORAGE_KEY = "georg-mail.avatar-style";

const listeners = new Set<() => void>();
let current: AvatarStyle = readStored();

function readStored(): AvatarStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return AVATAR_STYLES.find((style) => style === stored) ?? DEFAULT_AVATAR_STYLE;
  } catch {
    return DEFAULT_AVATAR_STYLE;
  }
}

export function getAvatarStyle(): AvatarStyle {
  return current;
}

export function setAvatarStyle(style: AvatarStyle): void {
  current = style;
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAvatarStyle(): AvatarStyle {
  return useSyncExternalStore(subscribe, getAvatarStyle, getAvatarStyle);
}
