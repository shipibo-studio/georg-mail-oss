import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { PREVIEW_LENGTH } from "../config";
import type { Database } from "../db/client";
import {
  type Attachment,
  attachments,
  type Message,
  messages,
  type SenderAuthentication,
  type TrustedSender,
} from "../db/schema";
import { isVerifiedSender, senderDomain } from "../email/sender-authentication";
import { stripInvisibleCharacters } from "../email/visible-text";
import { isPrivateHost } from "../http/private-hosts";
import type { ContentAccess, OptionalContent } from "./content-access";
import { senderTrust } from "./sender-trust";
import { foldForSearch } from "./text-folding";

export async function listAttachments(db: Database, messageId: string): Promise<Attachment[]> {
  return db.select().from(attachments).where(eq(attachments.messageId, messageId)).orderBy(asc(attachments.id));
}

export async function markAsRead(db: Database, message: Message): Promise<Message> {
  if (message.readAt) return message;
  const readAt = Date.now();
  await db
    .update(messages)
    .set({ readAt })
    .where(and(eq(messages.id, message.id), isNull(messages.readAt)));
  return { ...message, readAt };
}

/** Marks an unread message as read only if nobody else did first; returns it when this call won. */
export async function claimUnread(db: Database, message: Message): Promise<Message | null> {
  const readAt = Date.now();
  const claimed = await db
    .update(messages)
    .set({ readAt })
    .where(and(eq(messages.id, message.id), isNull(messages.readAt)))
    .returning({ id: messages.id });
  return claimed.length > 0 ? { ...message, readAt } : null;
}

/**
 * Case- and accent-insensitive "contains" filter in any script, with LIKE wildcards in the user's
 * text escaped. Rows stored before the folded column existed fall back to SQLite's ASCII lower().
 */
export function containsFilter(foldedColumn: AnySQLiteColumn, column: AnySQLiteColumn, text: string): SQL {
  const escaped = foldForSearch(text).replace(/[\\%_]/g, (character) => `\\${character}`);
  return sql`coalesce(${foldedColumn}, lower(${column})) LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export interface PresentOptions {
  access: ContentAccess;
  include: Set<OptionalContent>;
  /** Verified trusted senders of the message's project. */
  trustedSenders: TrustedSender[];
}

const iso = (timestamp: number | null) => (timestamp === null ? null : new Date(timestamp).toISOString());

/** Sender-written text shown to "safe" and "full" keys, without invisible characters. */
function visible(value: string | null): string | null {
  return value === null ? null : stripInvisibleCharacters(value);
}

/** Characters of safe text loaded for a preview: enough to fill it after collapsing whitespace. */
const PREVIEW_SOURCE_CHARS = PREVIEW_LENGTH * 4;

/**
 * Columns a message summary needs. Lists select these instead of whole rows, so a list of large
 * emails does not load every body from D1 only to show a short preview.
 */
export const summaryColumns = {
  id: messages.id,
  inboxId: messages.inboxId,
  fromAddress: messages.fromAddress,
  fromName: messages.fromName,
  envelopeFrom: messages.envelopeFrom,
  authentication: messages.authentication,
  internalSenderInboxId: messages.internalSenderInboxId,
  risk: messages.risk,
  codes: messages.codes,
  extractedByAi: messages.extractedByAi,
  attachmentCount: messages.attachmentCount,
  subject: messages.subject,
  safeText: sql<string | null>`substr(${messages.safeText}, 1, ${PREVIEW_SOURCE_CHARS})`,
  receivedAt: messages.receivedAt,
  readAt: messages.readAt,
};

export type MessageSummaryRow = Pick<
  Message,
  | "id"
  | "inboxId"
  | "fromAddress"
  | "fromName"
  | "envelopeFrom"
  | "authentication"
  | "internalSenderInboxId"
  | "risk"
  | "codes"
  | "extractedByAi"
  | "attachmentCount"
  | "subject"
  | "safeText"
  | "receivedAt"
  | "readAt"
>;

type SenderFields = Pick<
  Message,
  "fromAddress" | "fromName" | "envelopeFrom" | "authentication" | "internalSenderInboxId"
>;

function preview(message: Pick<Message, "safeText" | "subject">): string | null {
  const text = message.safeText ?? visible(message.subject);
  return text ? text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH) : null;
}

type AttachmentKind = "pdf" | "image" | "text" | "media" | "archive" | "document" | "other";

const ARCHIVE_TYPES = /zip|x-7z|gzip|x-tar|x-rar|vnd\.rar|x-bzip/;
const DOCUMENT_TYPES = /msword|officedocument|opendocument|ms-excel|ms-powerpoint|rtf/;

/** A closed set instead of the sender-written content type, for keys that must not read free text. */
function attachmentKind(contentType: string): AttachmentKind {
  const type = contentType.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/")) return "text";
  if (type.startsWith("audio/") || type.startsWith("video/")) return "media";
  if (ARCHIVE_TYPES.test(type)) return "archive";
  if (DOCUMENT_TYPES.test(type)) return "document";
  return "other";
}

/** Authentication results without the domains, which the sender chooses. */
function authenticationResults(authentication: SenderAuthentication | null) {
  if (!authentication) return null;
  return {
    dkim: authentication.dkim.map((signature) => signature.result),
    spf: authentication.spf?.result ?? null,
    dmarc: authentication.dmarc?.result ?? null,
  };
}

/**
 * Who sent the message. Every address, name and domain here is chosen by the sender, so "codes"
 * keys get only the verified domain (a registered domain that passed DMARC) and the results.
 * `verified` means DMARC passed for the From domain; `trusted` means the project trusts that sender.
 * Neither makes the content trustworthy.
 */
function presentSender(message: SenderFields, access: ContentAccess, verifiedTrustedSenders: TrustedSender[]) {
  // Sent from another inbox of the project through georg-mail: the sender is known for certain.
  const internal = message.internalSenderInboxId !== null;
  const verified = internal || isVerifiedSender(message.authentication, message.fromAddress);
  const identity = {
    domain: verified ? senderDomain(message.fromAddress) : null,
    verified,
    internal,
    senderInboxId: message.internalSenderInboxId,
    ...senderTrust(message, verifiedTrustedSenders),
  };
  if (access === "codes") return { ...identity, authentication: authenticationResults(message.authentication) };
  return {
    ...identity,
    address: visible(message.fromAddress),
    name: visible(message.fromName),
    envelopeFrom: visible(message.envelopeFrom || null),
    authentication: message.authentication,
  };
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isSameOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Links with what an agent needs to judge them: the domain (internationalized names in punycode,
 * which exposes look-alikes), whether it belongs to the verified or trusted sender, whether it is
 * HTTPS, and whether it points to a private network. "codes" keys only get HTTPS links on the
 * verified sender's own domain: any sender can put text in a URL, but only the domain owner can
 * pass DMARC for it.
 */
function presentLinks(message: Message, access: ContentAccess, verifiedTrustedSenders: TrustedSender[]) {
  const verifiedDomain = isVerifiedSender(message.authentication, message.fromAddress)
    ? senderDomain(message.fromAddress)
    : null;
  const fromTrusted = senderTrust(message, verifiedTrustedSenders).trusted;
  const links = message.links.map((link) => {
    const url = parseUrl(link.url);
    const domain = url?.hostname || null;
    const fromVerifiedSender = domain !== null && verifiedDomain !== null && isSameOrSubdomain(domain, verifiedDomain);
    return {
      url: link.url,
      domain,
      isVerification: link.isVerification,
      secure: url?.protocol === "https:",
      privateTarget: domain !== null && isPrivateHost(domain),
      fromVerifiedSender,
      fromTrustedSender: fromVerifiedSender && fromTrusted,
    };
  });
  if (access !== "codes") return links;
  return links.filter((link) => link.fromVerifiedSender && link.secure && !link.privateTarget);
}

function presentAttachments(attachmentRows: Attachment[], access: ContentAccess) {
  return attachmentRows.map((attachment) => {
    const common = {
      id: attachment.id,
      kind: attachmentKind(attachment.contentType),
      sizeBytes: attachment.sizeBytes,
      inline: attachment.isInline,
      omitted: attachment.omitted,
    };
    // File names and content types are chosen by the sender.
    if (access === "codes") return common;
    return { ...common, filename: visible(attachment.filename), contentType: visible(attachment.contentType) };
  });
}

export function presentMessageSummary(
  message: MessageSummaryRow,
  access: ContentAccess,
  trustedSenders: TrustedSender[],
) {
  const summary = {
    id: message.id,
    inboxId: message.inboxId,
    contentView: access,
    from: presentSender(message, access, trustedSenders),
    risk: message.risk,
    codes: message.codes,
    // The code or verification link came from the Workers AI fallback: found in the email, but a guess.
    extractedByAi: message.extractedByAi,
    attachmentCount: message.attachmentCount,
    receivedAt: iso(message.receivedAt),
    readAt: iso(message.readAt),
  };
  if (access === "codes") return summary;
  return { ...summary, subject: visible(message.subject), preview: preview(message) };
}

/**
 * Full message for the key's content access. `contentTrust` is always "untrusted": even a
 * verified sender's subject, text and links are data, never instructions.
 */
export function presentMessage(message: Message, attachmentRows: Attachment[], options: PresentOptions) {
  const base = {
    id: message.id,
    inboxId: message.inboxId,
    contentTrust: "untrusted" as const,
    contentView: options.access,
    from: presentSender(message, options.access, options.trustedSenders),
    // Closed-set reasons computed by georg-mail, safe at every content access level.
    risk: message.risk,
    to: message.toAddress,
    codes: message.codes,
    extractedByAi: message.extractedByAi,
    links: presentLinks(message, options.access, options.trustedSenders),
    attachmentCount: message.attachmentCount,
    attachments: presentAttachments(attachmentRows, options.access),
    sizeBytes: message.sizeBytes,
    hasRaw: message.rawObjectKey !== null,
    receivedAt: iso(message.receivedAt),
    readAt: iso(message.readAt),
  };
  if (options.access === "codes") return base;

  const readable = {
    ...base,
    subject: visible(message.subject),
    text: message.safeText,
    bodyTruncated: message.bodyTruncated,
    parseFailed: message.parseError !== null,
    inReplyTo: visible(message.inReplyTo),
  };
  if (options.access !== "full") return readable;
  return {
    ...readable,
    // Parser messages can echo sender input (a charset name), and the Message-ID header is free text.
    parseError: visible(message.parseError),
    messageIdHeader: visible(message.messageIdHeader),
    ...(options.include.has("html") ? { html: message.htmlBody } : {}),
    ...(options.include.has("rawText") ? { rawText: message.textBody } : {}),
  };
}
