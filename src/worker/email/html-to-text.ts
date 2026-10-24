// Bounds the work done on hostile HTML. Code extraction reads only the first 20 KB of text,
// and codes appear near the top of real emails.
const MAX_HTML_LENGTH = 50_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Punctuation that can spell CSS declarations ("display&colon;none") inside style attributes.
  colon: ":",
  semi: ";",
  comma: ",",
  period: ".",
  sol: "/",
  ast: "*",
  lpar: "(",
  rpar: ")",
  num: "#",
  excl: "!",
  percnt: "%",
  bsol: "\\",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

const NON_TEXT_ELEMENTS = ["script", "style", "head"];

/**
 * Removes every <script>, <style> and <head> element with its content in a single linear pass.
 * A regex with a lazy `[\s\S]*?` would be quadratic on hostile input with many unclosed tags.
 */
function removeNonTextElements(html: string): string {
  const lowercase = html.toLowerCase();
  // Next known position of each opening tag; refreshed only once the cursor passes it,
  // so each tag's occurrences are scanned once in total.
  const nextOpening = new Map(NON_TEXT_ELEMENTS.map((tag) => [tag, lowercase.indexOf(`<${tag}`)]));
  let result = "";
  let position = 0;
  while (position < html.length) {
    let next: { tag: string; index: number } | undefined;
    for (const tag of NON_TEXT_ELEMENTS) {
      let index = nextOpening.get(tag) ?? -1;
      if (index !== -1 && index < position) {
        index = lowercase.indexOf(`<${tag}`, position);
        nextOpening.set(tag, index);
      }
      if (index !== -1 && (!next || index < next.index)) next = { tag, index };
    }
    if (!next) break;
    result += `${html.slice(position, next.index)} `;
    const closing = lowercase.indexOf(`</${next.tag}`, next.index);
    if (closing === -1) return result; // unclosed: everything after it is non-text
    const closingEnd = lowercase.indexOf(">", closing);
    position = closingEnd === -1 ? html.length : closingEnd + 1;
  }
  return result + html.slice(position);
}

/**
 * Plain-text approximation of an HTML body, used only for code extraction when an email has
 * no text/plain part. It is not a sanitizer: the HTML itself is never rendered from this output.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    removeNonTextElements(html.slice(0, MAX_HTML_LENGTH))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, "\n")
      // `[^<>]` (not `[^>]`) keeps this linear: a failed match cannot rescan across another "<".
      .replace(/<[^<>]{0,2000}>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
