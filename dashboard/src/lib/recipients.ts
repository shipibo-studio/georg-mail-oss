// Recipient fields accept what people paste: "Ana <ana@x.com>, bob@y.com; carl@z.com".
// The API validates again; this only gives instant feedback while typing.
const ADDRESS = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const ANGLE_ADDRESS = /<([^<>]+)>/;

export function normalizeRecipient(value: string): string {
  const angle = ANGLE_ADDRESS.exec(value);
  return (angle?.[1] ?? value).trim().toLowerCase();
}

export function isValidAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

// Either "Any Name <address>" (names hold no "@") or a bare token between separators.
const RECIPIENT_TOKEN = /(?:"[^"]*"|[^,;<>"@])*<([^<>]+)>|[^,;\s<>"]+/g;

/** Splits pasted text into addresses, dropping display names and duplicates. */
export function splitRecipients(text: string): string[] {
  const found = Array.from(text.matchAll(RECIPIENT_TOKEN), (match) => normalizeRecipient(match[1] ?? match[0]));
  return [...new Set(found.filter((value) => value.length > 0))];
}

export function uniqueRecipients(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}
