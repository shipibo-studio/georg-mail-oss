import PostalMime from "postal-mime";
import { MAX_CODE_SCAN_CHARS } from "../config";
import { extractCode, joinSubjectAndBody } from "./extract-code";
import { extractLinks } from "./extract-links";
import { htmlToText } from "./html-to-text";

export interface ParsedAttachment {
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId: string | null;
}

export interface ParsedEmail {
  /** The Date header, as written by the sender's client; only imports rely on it. */
  date: string | null;
  /** To and Cc addresses, lowercased; groups are flattened. */
  toAddresses: string[];
  messageIdHeader: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  /** Topmost Authentication-Results header, the only one the receiving server can vouch for. */
  authenticationResults: string | null;
  codes: string[];
  links: { url: string; isVerification: boolean }[];
  attachments: ParsedAttachment[];
}

function attachmentSize(content: ArrayBuffer | Uint8Array | string): number {
  return typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength;
}

/** Parses a raw RFC 822 message and extracts the verification code and links. */
export async function parseEmail(raw: ArrayBuffer): Promise<ParsedEmail> {
  const email = await PostalMime.parse(raw);

  const textBody = email.text?.trim() || null;
  const htmlBody = email.html?.trim() || null;
  const subject = email.subject?.trim() || null;
  const textForExtraction = textBody ?? (htmlBody ? htmlToText(htmlBody) : "");
  // `from` can be an address group in theory; only a single mailbox identifies the sender.
  const sender = email.from && "address" in email.from ? email.from : undefined;
  const code = extractCode(joinSubjectAndBody(subject ?? undefined, textForExtraction.slice(0, MAX_CODE_SCAN_CHARS)));

  return {
    date: email.date ?? null,
    toAddresses: [...(email.to ?? []), ...(email.cc ?? [])]
      .flatMap((entry) => ("group" in entry && entry.group ? entry.group : [entry]))
      .flatMap((entry) => ("address" in entry && entry.address ? [entry.address.toLowerCase()] : [])),
    messageIdHeader: email.messageId ?? null,
    fromAddress: sender?.address?.toLowerCase() || null,
    fromName: sender?.name || null,
    subject,
    textBody,
    htmlBody,
    authenticationResults: email.headers.find((header) => header.key === "authentication-results")?.value ?? null,
    codes: code ? [code] : [],
    links: extractLinks(htmlBody, textBody),
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.mimeType || "application/octet-stream",
      sizeBytes: attachmentSize(attachment.content),
      isInline: attachment.disposition === "inline" || Boolean(attachment.contentId && attachment.related),
      contentId: attachment.contentId ?? null,
    })),
  };
}

export interface AttachmentQuery {
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  /** Among attachments with the same name, type and size, which one (0 for the first). */
  ordinal: number;
}

/** The content of one attachment, found again in the raw message by its recorded metadata. */
export async function extractAttachment(raw: ArrayBuffer, query: AttachmentQuery): Promise<Uint8Array | null> {
  const email = await PostalMime.parse(raw);
  const matches = email.attachments.filter(
    (attachment) =>
      (attachment.filename ?? null) === query.filename &&
      (attachment.mimeType || "application/octet-stream") === query.contentType &&
      attachmentSize(attachment.content) === query.sizeBytes,
  );
  const content = matches[query.ordinal]?.content;
  if (content === undefined) return null;
  return typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
}
