// Sender avatars: DiceBear "gaze" (CC0) with the same options as the owner's avatar, seeded by the
// sender's address so each sender always gets the same face. Rendered as a data: URI in an <img>,
// so the SVG can never run code; the seed only feeds DiceBear's random generator.
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/gaze.json";
import options from "./avatar-options.json";

const GAZE = new Style(definition);
// Enough for every sender on screen; old entries go first so memory stays bounded.
const MAX_CACHED_AVATARS = 500;
const cache = new Map<string, string>();

/** The seed for a sender: the address when there is one, case-insensitive, else the name. */
export function avatarSeed(name: string | null, address: string | null): string {
  return (address ?? name ?? "").trim().toLowerCase();
}

export function senderAvatarUri(seed: string): string {
  const cached = cache.get(seed);
  if (cached) return cached;
  const uri = new Avatar(GAZE, { ...options, seed }).toDataUri();
  if (cache.size >= MAX_CACHED_AVATARS) cache.delete(cache.keys().next().value as string);
  cache.set(seed, uri);
  return uri;
}
