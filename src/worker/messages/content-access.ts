import { z } from "zod";
import { ApiError } from "../errors";

/**
 * How much received content an API key may read, from least to most:
 * - "codes": extracted codes, links and metadata. No sender-written text at all, so an agent using
 *   it cannot be prompt-injected through email content.
 * - "safe": also the subject and the visible text, sanitized.
 * - "full": also, on request, the raw HTML, the original text part and the .eml file.
 */
export const CONTENT_ACCESS_LEVELS = ["codes", "safe", "full"] as const;
export type ContentAccess = (typeof CONTENT_ACCESS_LEVELS)[number];

/** Raw content a "full" key can ask for with `?include=html,rawText`. */
export const OPTIONAL_CONTENT = ["html", "rawText"] as const;
export type OptionalContent = (typeof OPTIONAL_CONTENT)[number];

export function grantsAtLeast(granted: ContentAccess, required: ContentAccess): boolean {
  return CONTENT_ACCESS_LEVELS.indexOf(granted) >= CONTENT_ACCESS_LEVELS.indexOf(required);
}

export function assertContentAccess(granted: ContentAccess, required: ContentAccess, what: string): void {
  if (!grantsAtLeast(granted, required)) {
    throw new ApiError("forbidden", `This API key cannot read ${what}.`, {
      hint: `It has "${granted}" content access; "${required}" is required. Raw content can carry hidden instructions, so give it only to keys that need it.`,
    });
  }
}

/** Parses `include=html,rawText`; an empty or missing value includes nothing. */
export const includeQuerySchema = z
  .string()
  .max(50)
  .optional()
  .transform((value, context) => {
    const requested = (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const unknown = requested.filter((item) => !(OPTIONAL_CONTENT as readonly string[]).includes(item));
    if (unknown.length > 0) {
      context.addIssue({ code: "custom", message: `Unknown include: ${unknown.join(", ")}. Use html, rawText.` });
      return z.NEVER;
    }
    return new Set(requested as OptionalContent[]);
  });
