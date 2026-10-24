// Text that an AI agent may read safely: only what a person would see when opening the email.
// Hidden elements, comments and invisible characters are the usual carriers of prompt injection,
// because a person reviewing the email cannot see them while a model reads them in full.
// This removes the common techniques; it is not a guarantee, so the content stays untrusted.
import { decodeEntities, htmlToText } from "./html-to-text";

/**
 * Characters that render as nothing or reorder text: zero-width and joiner characters, bidirectional
 * controls, the Unicode tag block used for "ASCII smuggling", variation selectors, interlinear
 * annotations, invisible fillers and C0/C1 controls other than tab, line feed and carriage return.
 */
// Written as \u escapes on purpose: the characters themselves are invisible in an editor.
const INVISIBLE_CHARACTERS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F\\u1160" +
    "\\u17B4\\u17B5\\u180B-\\u180F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\u3164" +
    "\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF9-\\uFFFB\\u{1D173}-\\u{1D17A}\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]",
  "gu",
);

/**
 * Elements whose content is never shown to the reader. <head> is not removed here because its
 * <style> blocks are read for hidden classes; htmlToText drops head, script and style text later.
 */
const NEVER_VISIBLE_ELEMENTS = "script, template, noscript, noembed, noframes, iframe, object, embed, title";

/** Style attributes longer than this are treated as hiding their element: real ones are short. */
const MAX_INSPECTED_STYLE_LENGTH = 10_000;
/** Style-block text read for hidden classes and ids. */
const MAX_STYLE_BLOCK_TEXT = 50_000;
/** Elements this small, or text this small, cannot be read by a person. */
const MAX_UNREADABLE_SIZE_PX = 2;
const MAX_UNREADABLE_OPACITY = 0.1;
const MAX_UNREADABLE_SCALE = 0.1;
/** Offsets this far negative push content off screen. */
const OFF_SCREEN_OFFSET_PX = -100;
const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, em: 16, rem: 16, "%": 0.16, ex: 8, ch: 8 };
const BASIC_COLORS: Record<string, string> = { white: "ffffff", black: "000000" };

export function stripInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTERS, "");
}

/** Removes CSS comments in one linear pass (a lazy regex is quadratic on unclosed comments). */
function stripCssComments(css: string): string {
  let result = "";
  let position = 0;
  while (position < css.length) {
    const start = css.indexOf("/*", position);
    if (start === -1) return result + css.slice(position);
    result += css.slice(position, start);
    const end = css.indexOf("*/", start + 2);
    if (end === -1) return result;
    position = end + 2;
  }
  return result;
}

/** Decodes what a browser decodes before applying a style: HTML entities, CSS escapes, comments. */
function normalizeCss(css: string): string {
  return stripCssComments(decodeEntities(css))
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_escape, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/\\(.)/g, "$1")
    .toLowerCase()
    .replace(/!important/g, "");
}

function parseDeclarations(css: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of css.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration
      .slice(separator + 1)
      .trim()
      .replace(/\s+/g, " ");
    if (property) declarations.set(property, value);
  }
  return declarations;
}

/** A CSS length in pixels, or null for keywords and unknown units. */
function toPixels(value: string | undefined): number | null {
  const match = value?.match(/^(-?\d*\.?\d+)(px|pt|pc|em|rem|%|ex|ch)?$/);
  if (!match) return null;
  return Number(match[1]) * (PX_PER_UNIT[match[2] ?? "px"] ?? 1);
}

function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;
  const color = value.split(" ")[0] ?? "";
  if (BASIC_COLORS[color]) return BASIC_COLORS[color];
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)?.[1];
  if (hex) return hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const rgb = color.match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})/);
  if (rgb)
    return rgb
      .slice(1, 4)
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("");
  return null;
}

function isTiny(value: string | undefined): boolean {
  const pixels = toPixels(value);
  return pixels !== null && pixels <= MAX_UNREADABLE_SIZE_PX;
}

/** True when a set of declarations makes its element unreadable to a person. */
function hidesContent(declarations: Map<string, string>): boolean {
  const get = (property: string) => declarations.get(property);
  if (get("display") === "none") return true;
  if (get("visibility") === "hidden" || get("visibility") === "collapse") return true;
  const opacity = get("opacity");
  if (opacity !== undefined) {
    const amount = opacity.endsWith("%") ? Number.parseFloat(opacity) / 100 : Number.parseFloat(opacity);
    if (Number.isFinite(amount) && amount <= MAX_UNREADABLE_OPACITY) return true;
  }
  if (isTiny(get("font-size"))) return true;
  if (get("color") === "transparent") return true;
  const color = normalizeColor(get("color"));
  if (color !== null && color === normalizeColor(get("background-color") ?? get("background"))) return true;
  const transform = get("transform") ?? "";
  for (const match of transform.matchAll(/scale[xy]?\(\s*(-?\d*\.?\d+)/g)) {
    if (Math.abs(Number(match[1])) <= MAX_UNREADABLE_SCALE) return true;
  }
  if (/^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)/.test(get("clip") ?? "")) return true;
  if (/^(?:inset\(\s*(?:50|100)%|circle\(\s*0)/.test(get("clip-path") ?? "")) return true;
  for (const property of ["left", "right", "top", "text-indent", "margin-left", "margin-top"]) {
    const offset = toPixels(get(property));
    if (offset !== null && offset <= OFF_SCREEN_OFFSET_PX) return true;
  }
  const clipsOverflow =
    get("overflow") === "hidden" || get("overflow-x") === "hidden" || get("overflow-y") === "hidden";
  const collapsed = ["height", "width", "max-height", "max-width", "line-height"].some((property) =>
    isTiny(get(property)),
  );
  return clipsOverflow && collapsed;
}

/** True when an inline style hides the element from the reader. Oversized styles fail closed. */
export function isHiddenByStyle(style: string): boolean {
  if (style.length > MAX_INSPECTED_STYLE_LENGTH) return true;
  return hidesContent(parseDeclarations(normalizeCss(style)));
}

/** Classes and ids that <style> blocks hide, for example `.preheader { display: none }`. */
export function hiddenSelectorsFromCss(css: string): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const normalized = normalizeCss(css.slice(0, MAX_STYLE_BLOCK_TEXT));
  for (const rule of normalized.matchAll(/([^{}]{1,1000})\{([^{}]{0,5000})\}/g)) {
    if (!hidesContent(parseDeclarations(rule[2] ?? ""))) continue;
    for (const selector of (rule[1] ?? "").split(",")) {
      // The last compound of each selector: ".card .secret" hides elements with class "secret".
      const target =
        selector
          .trim()
          .split(/[\s>+~]+/)
          .at(-1) ?? "";
      for (const match of target.matchAll(/\.([a-z0-9_-]+)/g)) if (match[1]) classes.add(match[1]);
      for (const match of target.matchAll(/#([a-z0-9_-]+)/g)) if (match[1]) ids.add(match[1]);
    }
  }
  return { classes, ids };
}

/** A link as a reader sees it: where it goes and the text it shows. */
export interface VisibleAnchor {
  href: string;
  text: string;
}

export interface InspectedContent {
  /** What a person sees; null when nothing visible remains. */
  visibleText: string | null;
  /** The HTML with hidden parts removed, for extracting only links a person can see. */
  visibleHtml: string | null;
  /** All text of the HTML, hidden parts included, without invisible characters. */
  fullText: string | null;
  /** Characters of text present in the email but hidden from the reader. */
  hiddenTextLength: number;
  /** Visible links with their text, for spotting links whose text names another domain. */
  anchors: VisibleAnchor[];
}

/** Bounds the anchors kept for risk checks, and the text kept per anchor. */
const MAX_ANCHORS = 50;
const MAX_ANCHOR_TEXT = 200;
/**
 * HTML inspected per message. The runtime's parser costs CPU in proportion to the input, and
 * Workers Free allows 10 ms per email; longer HTML is cut and reported as truncated.
 */
export const MAX_INSPECTED_HTML_CHARS = 64_000;

class HiddenContentRemover {
  readonly anchors: VisibleAnchor[] = [];
  private currentAnchor: VisibleAnchor | null = null;
  private styleText = "";
  private hidden: { classes: Set<string>; ids: Set<string> } | null = null;

  private hiddenSelectors() {
    this.hidden ??= hiddenSelectorsFromCss(this.styleText);
    return this.hidden;
  }

  private isHidden(element: Element): boolean {
    if (element.hasAttribute("hidden")) return true;
    if (element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true") return true;
    const style = element.getAttribute("style");
    if (style !== null && isHiddenByStyle(style)) return true;
    if (!this.styleText) return false;
    const { classes, ids } = this.hiddenSelectors();
    const id = element.getAttribute("id")?.trim().toLowerCase();
    if (id && ids.has(id)) return true;
    const classList = (element.getAttribute("class") ?? "").toLowerCase().split(/\s+/);
    return classList.some((name) => name && classes.has(name));
  }

  rewriter(): HTMLRewriter {
    return new HTMLRewriter()
      .on("style", {
        // Collected, not removed: htmlToText drops style text, and its rules reveal hidden classes.
        text: (chunk) => {
          if (this.styleText.length < MAX_STYLE_BLOCK_TEXT) {
            this.styleText += chunk.text;
            this.hidden = null;
          }
        },
      })
      .on(NEVER_VISIBLE_ELEMENTS, { element: (element) => void element.remove() })
      .on("dialog", {
        element: (element) => {
          if (!element.hasAttribute("open")) element.remove();
        },
      })
      .on("[hidden], [aria-hidden], [style], [class], [id]", {
        element: (element) => {
          if (this.isHidden(element)) element.remove();
        },
      })
      .on("a[href]", {
        element: (element) => {
          this.currentAnchor = null;
          if (element.removed || this.anchors.length >= MAX_ANCHORS) return;
          this.currentAnchor = { href: element.getAttribute("href") ?? "", text: "" };
          this.anchors.push(this.currentAnchor);
        },
        text: (chunk) => {
          if (this.currentAnchor && this.currentAnchor.text.length < MAX_ANCHOR_TEXT) {
            this.currentAnchor.text += chunk.text;
          }
        },
      })
      .onDocument({ comments: (comment) => void comment.remove() });
  }
}

/**
 * The text a person would see (visible HTML when there is HTML, otherwise the plain-text part,
 * without invisible characters), plus the visible HTML, what was hidden and the visible links.
 */
export async function inspectContent(html: string | null, text: string | null): Promise<InspectedContent> {
  if (html) {
    const inspected = html.slice(0, MAX_INSPECTED_HTML_CHARS);
    const remover = new HiddenContentRemover();
    const visibleHtml = await remover.rewriter().transform(new Response(inspected)).text();
    const visibleText = stripInvisibleCharacters(htmlToText(visibleHtml)).trim();
    const fullText = stripInvisibleCharacters(htmlToText(inspected)).trim();
    return {
      visibleText: visibleText || null,
      visibleHtml,
      fullText: fullText || null,
      hiddenTextLength: Math.max(0, fullText.length - visibleText.length),
      anchors: remover.anchors.map((anchor) => ({ href: anchor.href.trim(), text: htmlToText(anchor.text).trim() })),
    };
  }
  const visibleText = text ? stripInvisibleCharacters(text).trim() : "";
  return { visibleText: visibleText || null, visibleHtml: null, fullText: null, hiddenTextLength: 0, anchors: [] };
}

export async function extractVisibleText(html: string | null, text: string | null): Promise<string | null> {
  return (await inspectContent(html, text)).visibleText;
}
