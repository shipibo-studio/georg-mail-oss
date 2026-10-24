// The analysis every stored message goes through, whether it arrived from the internet or from
// another inbox of the project: the text a person sees, the links they can see, and risk signals.
import { MAX_STORED_HTML_CHARS, MAX_STORED_TEXT_CHARS } from "../config";
import type { ExtractedLinkRecord, MessageRisk } from "../db/schema";
import { extractLinks } from "./extract-links";
import { assessRisk } from "./risk-signals";
import { type InspectedContent, inspectContent, MAX_INSPECTED_HTML_CHARS } from "./visible-text";

export interface ContentToAnalyze {
  subject: string | null;
  text: string | null;
  html: string | null;
  fromName: string | null;
  messageIdHeader: string | null;
  attachments: { filename: string | null; contentType: string }[];
  senderVerified: boolean;
}

export interface AnalyzedContent {
  text: string | null;
  html: string | null;
  safeText: string | null;
  links: ExtractedLinkRecord[];
  risk: MessageRisk;
  truncated: boolean;
  /** Characters this message keeps in D1, counted against the account's storage quota. */
  storedBytes: number;
}

function truncate(value: string | null, maxChars: number): { value: string | null; truncated: boolean } {
  if (value === null || value.length <= maxChars) return { value, truncated: false };
  return { value: value.slice(0, maxChars), truncated: true };
}

/** A message whose content cannot be inspected is stored without the safe text rather than lost. */
async function inspectOrEmpty(html: string | null, text: string | null): Promise<InspectedContent> {
  try {
    return await inspectContent(html, text);
  } catch (error) {
    console.warn("Could not extract visible text", { error: error instanceof Error ? error.name : "unknown" });
    return { visibleText: null, visibleHtml: null, fullText: null, hiddenTextLength: 0, anchors: [] };
  }
}

export async function analyzeContent(content: ContentToAnalyze): Promise<AnalyzedContent> {
  const text = truncate(content.text, MAX_STORED_TEXT_CHARS);
  const html = truncate(content.html, MAX_STORED_HTML_CHARS);
  const inspected = await inspectOrEmpty(html.value, text.value);
  // Only links a person can see: hidden links are where a phishing target hides. Without HTML the
  // plain text is what a person reads; if the HTML could not be inspected, no link is trusted.
  const links = html.value === null ? extractLinks(null, text.value) : extractLinks(inspected.visibleHtml ?? "", null);
  const safeText = truncate(inspected.visibleText, MAX_STORED_TEXT_CHARS);
  const risk = assessRisk({
    received: { subject: content.subject, text: text.value, html: html.value },
    subject: content.subject,
    fromName: content.fromName,
    messageIdHeader: content.messageIdHeader,
    rawText: text.value,
    fullHtmlText: inspected.fullText,
    visibleText: inspected.visibleText,
    hasHtml: html.value !== null,
    hiddenTextLength: inspected.hiddenTextLength,
    anchors: inspected.anchors,
    links: links.map((link) => link.url),
    attachments: content.attachments,
    senderVerified: content.senderVerified,
  });
  return {
    text: text.value,
    html: html.value,
    safeText: safeText.value,
    links,
    risk,
    truncated: text.truncated || html.truncated || (html.value?.length ?? 0) > MAX_INSPECTED_HTML_CHARS,
    storedBytes: (text.value?.length ?? 0) + (html.value?.length ?? 0) + (safeText.value?.length ?? 0),
  };
}
