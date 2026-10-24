// Signals that a received email may try to manipulate an AI agent or a person. They are hints for
// deciding how much to trust a message, never a guarantee: a careful attacker can avoid all of
// them, so content stays untrusted whatever the level says.
import type { MessageRisk, RiskLevel, RiskReason } from "../db/schema";
import { stripInvisibleCharacters, type VisibleAnchor } from "./visible-text";

const SEVERITY: Record<RiskReason, RiskLevel> = {
  injection_phrases: "high",
  tag_characters: "high",
  link_text_mismatch: "high",
  risky_attachment: "high",
  hidden_content: "medium",
  text_html_mismatch: "medium",
  invisible_characters: "medium",
  lookalike_link: "medium",
  unauthenticated_sender: "low",
};
const LEVEL_ORDER: RiskLevel[] = ["low", "medium", "high"];

/**
 * Phrases that address a model rather than a person, in English, Spanish and Portuguese. Matched
 * case-insensitively on text with whitespace collapsed; every pattern is linear.
 */
const INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions|prompts?|rules|messages)/i,
  /\b(?:ignora|olvida|omite)\s+(?:todas\s+)?(?:las\s+|tus\s+)?instrucciones\s+(?:anteriores|previas)/i,
  /\bhaz\s+caso\s+omiso\s+(?:de\s+)?(?:todas\s+)?(?:las\s+|tus\s+)?instrucciones/i,
  /\bignore[zr]?\s+(?:toutes\s+)?(?:les\s+|vos\s+)?instructions\s+(?:pr[eé]c[eé]dentes|ant[eé]rieures)/i,
  /\bignoriere\s+(?:alle\s+)?(?:vorherigen|bisherigen|vorigen)\s+(?:anweisungen|instruktionen)/i,
  /\b(?:ignore|esqueça|desconsidere)\s+(?:todas\s+)?(?:as\s+|suas\s+)?instru[cç][oõ]es\s+(?:anteriores|pr[eé]vias)/i,
  /\byou\s+are\s+now\s+(?:an?\s+|the\s+)?(?:ai|assistant|agent|model|chatbot)\b/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\b(?:new|updated|real)\s+instructions\s*:/i,
  /(?:^|\s)(?:system|assistant)\s*:\s/i,
  /<\|im_(?:start|end)\|>|\[\/?INST\]|<\/?system>|###\s*(?:instruction|system)\b/i,
  /\b(?:forward|send|email|exfiltrate)\s+(?:all|every|each)\s+(?:of\s+)?(?:the\s+|your\s+)?(?:emails?|messages?|inbox)/i,
  /\b(?:reveal|print|share|send|leak)\s+(?:me\s+)?(?:the\s+|your\s+)?(?:api\s+keys?|secrets?|credentials|passwords?|tokens?)\b/i,
];
const MAX_SCANNED_CHARS = 50_000;

// Written as \u escapes on purpose: the characters themselves are invisible in an editor.
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const BIDIRECTIONAL_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;
/** Subdivision flag emoji use a handful of tag characters; more than this is hidden text. */
const MAX_LEGITIMATE_TAG_CHARACTERS = 8;
const MIN_ZERO_WIDTH_CHARACTERS = 5;
/** Hidden preheaders are short; more hidden text than this is worth a look. */
const MAX_UNREMARKABLE_HIDDEN_TEXT = 300;

const RISKY_EXTENSIONS =
  /\.(?:exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msix|jar|lnk|iso|img|vhd|reg|cpl|dll|html?|svg|shtml|docm|xlsm|pptm|dotm|xlam)$/i;
const RISKY_CONTENT_TYPES =
  /^(?:application\/(?:x-msdownload|x-msdos-program|x-dosexec|x-sh|x-bat|javascript|x-javascript|hta|java-archive|x-ms-shortcut|vnd\.ms-excel\.sheet\.macroenabled\.12|vnd\.ms-word\.document\.macroenabled\.12)|text\/(?:html|javascript)|image\/svg\+xml)$/i;
const DOMAIN_IN_TEXT = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/i;
const MIN_PLAIN_TEXT_WORDS = 20;
/** Share of the plain-text part's words that must also appear in the visible HTML. */
const MIN_SHARED_WORD_RATIO = 0.5;

/**
 * Common Cyrillic and Greek letters that look like Latin ones. Attackers swap them in ("іgnоre")
 * so a phrase reads the same to a model but slips past matching.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ї: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ԛ: "q",
  ԝ: "w",
  ɡ: "g",
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
const CONFUSABLE_PATTERN = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

/** Text as a model effectively reads it: compatibility forms folded, invisible characters gone. */
export function normalizeForScan(text: string): string {
  return stripInvisibleCharacters(text.slice(0, MAX_SCANNED_CHARS).normalize("NFKC"))
    .toLowerCase()
    .replace(CONFUSABLE_PATTERN, (character) => CONFUSABLES[character] ?? character)
    .replace(/\s+/g, " ");
}

export interface RiskInput {
  /** Subject, plain-text part and HTML exactly as received, for counting invisible characters. */
  received: { subject: string | null; text: string | null; html: string | null };
  subject: string | null;
  /** Other sender-written strings delivered to agents. */
  fromName: string | null;
  messageIdHeader: string | null;
  /** Original plain-text part, which mail clients usually do not show next to HTML. */
  rawText: string | null;
  /** Text of the HTML including hidden parts, without invisible characters. */
  fullHtmlText: string | null;
  visibleText: string | null;
  hasHtml: boolean;
  hiddenTextLength: number;
  anchors: VisibleAnchor[];
  links: string[];
  attachments: { filename: string | null; contentType: string }[];
  senderVerified: boolean;
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isSameSite(first: string, second: string): boolean {
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function hasInjectionPhrases(texts: (string | null)[]): boolean {
  return texts.some((text) => {
    if (!text) return false;
    const normalized = normalizeForScan(text);
    return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

/** The plain-text part says something the visible HTML does not: a place to hide instructions. */
function plainTextDiverges(rawText: string | null, visibleText: string | null, hasHtml: boolean): boolean {
  if (!hasHtml || !rawText) return false;
  const plainWords = words(rawText.slice(0, MAX_SCANNED_CHARS));
  if (plainWords.size < MIN_PLAIN_TEXT_WORDS) return false;
  const visibleWords = words((visibleText ?? "").slice(0, MAX_SCANNED_CHARS));
  const shared = [...plainWords].filter((word) => visibleWords.has(word)).length;
  return shared / plainWords.size < MIN_SHARED_WORD_RATIO;
}

/** A link whose visible text names one domain while it points to another. */
function linkTextMismatch(anchors: VisibleAnchor[]): boolean {
  return anchors.some((anchor) => {
    const shownDomain = anchor.text.match(DOMAIN_IN_TEXT)?.[1]?.toLowerCase();
    const target = hostnameOf(anchor.href);
    return Boolean(shownDomain && target && !isSameSite(shownDomain, target));
  });
}

export function assessRisk(input: RiskInput): MessageRisk {
  const reasons = new Set<RiskReason>();
  const received = [input.received.subject, input.received.text, input.received.html]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_SCANNED_CHARS * 3);

  const deliveredStrings = [
    input.subject,
    input.fromName,
    input.messageIdHeader,
    input.rawText,
    input.fullHtmlText,
    input.visibleText,
    ...input.attachments.map((attachment) => attachment.filename),
  ];
  if (hasInjectionPhrases(deliveredStrings)) {
    reasons.add("injection_phrases");
  }
  if (count(received, TAG_CHARACTERS) > MAX_LEGITIMATE_TAG_CHARACTERS) reasons.add("tag_characters");
  if (count(received, BIDIRECTIONAL_CONTROLS) > 0 || count(received, ZERO_WIDTH) >= MIN_ZERO_WIDTH_CHARACTERS) {
    reasons.add("invisible_characters");
  }
  if (input.hiddenTextLength > MAX_UNREMARKABLE_HIDDEN_TEXT) reasons.add("hidden_content");
  if (plainTextDiverges(input.rawText, input.visibleText, input.hasHtml)) reasons.add("text_html_mismatch");
  if (
    input.links.some((link) =>
      hostnameOf(link)
        ?.split(".")
        .some((label) => label.startsWith("xn--")),
    )
  ) {
    reasons.add("lookalike_link");
  }
  if (linkTextMismatch(input.anchors)) reasons.add("link_text_mismatch");
  if (
    input.attachments.some(
      (attachment) =>
        RISKY_EXTENSIONS.test(attachment.filename ?? "") || RISKY_CONTENT_TYPES.test(attachment.contentType),
    )
  ) {
    reasons.add("risky_attachment");
  }
  if (!input.senderVerified) reasons.add("unauthenticated_sender");

  const ordered = [...reasons].sort(
    (first, second) => LEVEL_ORDER.indexOf(SEVERITY[second]) - LEVEL_ORDER.indexOf(SEVERITY[first]),
  );
  const level = ordered.reduce<RiskLevel>(
    (highest, reason) =>
      LEVEL_ORDER.indexOf(SEVERITY[reason]) > LEVEL_ORDER.indexOf(highest) ? SEVERITY[reason] : highest,
    "low",
  );
  return { level, reasons: ordered };
}
