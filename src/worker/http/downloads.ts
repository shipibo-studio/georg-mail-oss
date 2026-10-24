// Downloaded files (original messages and attachments, from personal mail or through the API) come
// from strangers. They are always served as opaque downloads: never rendered by the browser, never
// sniffed into HTML, and sandboxed should anything try to open them in place.

const MAX_FILENAME_CHARS = 150;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
// Path separators, quotes and characters that break Content-Disposition.
const UNSAFE_PUNCTUATION = new Set(['"', "\\", "/", ":", "*", "?", "<", ">", "|", ";"]);
const LEADING_DOTS = /^\.+/;

function isUnsafe(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < FIRST_PRINTABLE || code === DELETE || UNSAFE_PUNCTUATION.has(character);
}

/** Each run of control characters, separators or quotes becomes one "_"; leading dots go. */
export function safeFilename(name: string | null | undefined, fallback: string): string {
  let cleaned = "";
  let previousUnsafe = false;
  for (const character of name ?? "") {
    const unsafe = isUnsafe(character);
    if (!unsafe) cleaned += character;
    else if (!previousUnsafe) cleaned += "_";
    previousUnsafe = unsafe;
  }
  return cleaned.replace(LEADING_DOTS, "").trim().slice(0, MAX_FILENAME_CHARS) || fallback;
}

/** ASCII-only fallback for old clients; the UTF-8 name goes in filename* (RFC 6266). */
function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_");
}

export function downloadHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
