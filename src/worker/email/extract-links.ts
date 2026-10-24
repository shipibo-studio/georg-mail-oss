import { MAX_LINKS_PER_MESSAGE } from "../config";
import type { ExtractedLinkRecord } from "../db/schema";

const MAX_SCAN_LENGTH = 200_000;
const MAX_URL_LENGTH = 2_048;

const HREF_PATTERN = /href\s*=\s*["']([^"'\s<>]{1,2048})["']/gi;
const BARE_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'()]{1,2048}/gi;
// Path or query words used by sign-up, login and password flows.
const VERIFICATION_HINT =
  /verif|confirm|activat|validat|magic|sign-?in|log-?in|auth|reset|password|token|otp|onboard|invite|accept/i;
// Links that appear in almost every email and are never what an agent is looking for.
const NOISE_HINT = /unsubscribe|preferences|privacy|terms|\.(png|jpe?g|gif|svg|webp|css)(\?|$)/i;

function normalizeUrl(candidate: string): string | null {
  const trimmed = candidate.replace(/&amp;/g, "&").replace(/[.,;:!?]+$/, "");
  if (trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Extracts unique http(s) links from the HTML and text bodies, verification-looking links first.
 * Only http(s) URLs are returned: `javascript:`, `data:` and other schemes are dropped.
 */
export function extractLinks(html: string | null | undefined, text: string | null | undefined): ExtractedLinkRecord[] {
  const candidates = [
    ...[...(html ?? "").slice(0, MAX_SCAN_LENGTH).matchAll(HREF_PATTERN)].map((match) => match[1] ?? ""),
    ...[...(text ?? "").slice(0, MAX_SCAN_LENGTH).matchAll(BARE_URL_PATTERN)].map((match) => match[0]),
  ];

  const unique = new Map<string, ExtractedLinkRecord>();
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (!url || unique.has(url) || NOISE_HINT.test(url)) continue;
    unique.set(url, { url, isVerification: VERIFICATION_HINT.test(url) });
  }

  return [...unique.values()]
    .sort((first, second) => Number(second.isVerification) - Number(first.isVerification))
    .slice(0, MAX_LINKS_PER_MESSAGE);
}
