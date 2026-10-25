// Message-IDs that came in with an email, as far as they may be copied into a reply's headers.
const MESSAGE_ID_PATTERN = /^<[^<>\s]{1,250}>$/;

/** A parent's Message-ID, only when it is safe to copy into our own In-Reply-To and References. */
export function threadableMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && MESSAGE_ID_PATTERN.test(trimmed) ? trimmed : null;
}
