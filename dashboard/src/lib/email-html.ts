// Turns an email's HTML (untrusted) into a document for a sandboxed iframe. Three layers:
//   1. DOMPurify removes scripts, event handlers, forms, embedded frames and dangerous URLs.
//   2. The document carries its own Content-Security-Policy: no scripts, no requests at all, and
//      remote images only after the owner asks for them (they are how senders track opens).
//   3. The iframe is sandboxed without allow-scripts (see EmailFrame), so nothing in it can run.
import DOMPurify from "dompurify";

const FORBIDDEN_TAGS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "portal",
];
const FORBIDDEN_ATTRIBUTES = ["srcset", "ping", "formaction", "action", "background", "poster"];
const SAFE_LINK = /^(?:https?:|mailto:)/i;
const REMOTE_URL = /^(?:https?:)?\/\//i;
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;

export interface EmailDocumentOptions {
  allowRemoteImages: boolean;
}

export interface PreparedEmail {
  /** A complete HTML document for the iframe's srcdoc. */
  document: string;
  /** True when the email asks for images or styles from the network (blocked unless allowed). */
  hasRemoteContent: boolean;
}

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (!SAFE_LINK.test(href.trim())) node.removeAttribute("href");
      // Links open outside the app, without telling the destination where they came from.
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
}

/**
 * Parses the email inertly (DOMParser runs no scripts and loads nothing), keeps the <style> blocks
 * from its <head>, and sanitizes everything as body content.
 */
export class SanitizerUnavailableError extends Error {
  constructor() {
    super("DOMPurify cannot run in this environment; the email HTML is not shown.");
    this.name = "SanitizerUnavailableError";
  }
}

function sanitize(html: string): Element {
  // Without DOM support DOMPurify returns its input untouched: fail closed instead.
  if (!DOMPurify.isSupported) throw new SanitizerUnavailableError();
  installHooks();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const headStyles = Array.from(
    parsed.head.querySelectorAll("style"),
    (style) => `<style>${style.textContent}</style>`,
  );
  return DOMPurify.sanitize(headStyles.join("") + parsed.body.innerHTML, {
    // Keeps leading <style> elements, which browsers would otherwise move out of the body.
    FORCE_BODY: true,
    RETURN_DOM: true,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target"],
  }) as Element;
}

function hasRemoteReferences(root: Element): boolean {
  for (const image of root.querySelectorAll("img[src]")) {
    if (REMOTE_URL.test(image.getAttribute("src") ?? "")) return true;
  }
  for (const element of root.querySelectorAll("[style]")) {
    if (REMOTE_CSS_URL.test(element.getAttribute("style") ?? "")) return true;
  }
  for (const style of root.querySelectorAll("style")) {
    if (REMOTE_CSS_URL.test(style.textContent ?? "")) return true;
  }
  return false;
}

/** The frame's own policy. It can only narrow the dashboard's policy, never widen it. */
export function emailContentSecurityPolicy({ allowRemoteImages }: EmailDocumentOptions): string {
  const images = allowRemoteImages ? "data: cid: https:" : "data: cid:";
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${images}; font-src data:`;
}

// Email HTML is designed for a white page: it stays white in dark mode too (georg-ds rule).
const BASE_STYLE = `
  html { background: #fff; color-scheme: light; }
  body { margin: 0; padding: 20px 24px; color: #18181b; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  a { color: #4a4ac4; }
`;

export function prepareEmailDocument(html: string, options: EmailDocumentOptions): PreparedEmail {
  const root = sanitize(html);
  const policy = emailContentSecurityPolicy(options);
  const document = [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta charset="utf-8">',
    '<base target="_blank">',
    `<style>${BASE_STYLE}</style>`,
    "</head><body>",
    root.innerHTML,
    "</body></html>",
  ].join("");
  return { document, hasRemoteContent: hasRemoteReferences(root) };
}
