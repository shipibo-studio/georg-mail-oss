// Imports the owner's old mail (a Zoho export, any .eml or .mbox) one message per request: the
// browser unpacks the archive and sends each message on its own, so every request stays inside the
// Workers Free CPU limit. A message keeps its date, arrives read and lands in the folder chosen.
// Imported mail is never forwarded, announced or filtered, and a message already in the mailbox
// (same Message-ID) is skipped, so an interrupted import can simply be run again.
import { and, eq, sql } from "drizzle-orm";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_HEADER_BLOCK_BYTES, PERSONAL_RAW_QUOTA_BYTES } from "../config";
import type { Database } from "../db/client";
import { accounts, attachments, type Inbox, inboxes, messages, type plans } from "../db/schema";
import { analyzeContent } from "../email/analyze-content";
import { parseEmail } from "../email/parse-email";
import { emptyParsedEmail, keepOriginalReadHeaders, type RawMessage, readMessage } from "../email/receive-email";
import { isVerifiedSender, parseAuthenticationResults } from "../email/sender-authentication";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { searchColumns } from "../messages/text-folding";
import { PERSONAL_ROOT_PREFIX, rawMessageKey } from "../storage/raw-messages";

/** Where imported mail can go. Spam and Trash are left out: there is no point importing either. */
export const IMPORT_FOLDERS = ["inbox", "sent", "archive"] as const;
export type ImportFolder = (typeof IMPORT_FOLDERS)[number];
export const PERSONAL_IMPORT_PATH = "/dashboard/api/mailbox/imports";
export const IMPORT_FOLDER_HEADER = "X-Import-Folder";
/** Email Routing accepts up to 25 MiB; an imported message can be as large. */
export const IMPORT_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dates before this are a broken clock, not old mail. */
const EARLIEST_DATE_MS = Date.UTC(1990, 0, 1);

type Plan = typeof plans.$inferSelect;
export type ImportResult = { status: "imported" | "duplicate"; messageId: string };

/**
 * When the message was sent, from its Date header. A missing, unreadable or impossible date (before
 * 1990, or more than a day ahead) becomes the time of the import.
 */
export function importedAt(dateHeader: string | null, now: number): number {
  const sent = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (!Number.isFinite(sent) || sent < EARLIEST_DATE_MS || sent > now + DAY_MS) return now;
  return Math.min(sent, now);
}

async function findByMessageId(db: Database, mailbox: Inbox, messageIdHeader: string | null) {
  if (!messageIdHeader) return null;
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.inboxId, mailbox.id), eq(messages.messageIdHeader, messageIdHeader)))
    .limit(1);
  return existing?.id ?? null;
}

async function assertRoom(db: Database, mailbox: Inbox, plan: Plan, rawSize: number, bodyParsed: boolean) {
  if (mailbox.rawBytes + rawSize > PERSONAL_RAW_QUOTA_BYTES) {
    throw new ApiError("plan_limit", "The mailbox's storage is full.", { hint: "Delete old mail to make room." });
  }
  const [account] = await db
    .select({ storedBytes: accounts.storedBytes })
    .from(accounts)
    .where(eq(accounts.id, mailbox.accountId));
  const estimatedBytes = bodyParsed ? rawSize : MAX_HEADER_BLOCK_BYTES;
  if ((account?.storedBytes ?? 0) + estimatedBytes > plan.maxStorageBytes) {
    throw new ApiError("plan_limit", "The account's storage is full.", { hint: "Delete old mail to make room." });
  }
}

export async function importMessage(
  env: { MAIL_STORAGE: R2Bucket },
  db: Database,
  mailbox: Inbox,
  plan: Plan,
  raw: RawMessage,
  folder: ImportFolder,
): Promise<ImportResult> {
  // Too large to parse within the CPU limit: kept whole in R2, read by its headers only.
  const bodyParsed = raw.rawSize <= plan.maxMessageBytes;
  await assertRoom(db, mailbox, plan, raw.rawSize, bodyParsed);

  const messageId = createId("msg");
  const rawObjectKey = rawMessageKey(mailbox.accountId, mailbox.id, messageId, PERSONAL_ROOT_PREFIX);
  let bytes: ArrayBuffer;
  try {
    bytes = bodyParsed
      ? await readMessage(raw, env.MAIL_STORAGE, rawObjectKey)
      : await keepOriginalReadHeaders(raw, env.MAIL_STORAGE, rawObjectKey);
  } catch (error) {
    await env.MAIL_STORAGE.delete(rawObjectKey);
    console.error("Failed to keep an imported message", { error: error instanceof Error ? error.name : "unknown" });
    throw new ApiError("unavailable", "The message could not be stored.", { hint: "Try this file again." });
  }

  let parsed = emptyParsedEmail();
  let parseError: string | null = null;
  try {
    parsed = await parseEmail(bytes);
  } catch (error) {
    parseError = error instanceof Error ? error.message.slice(0, 500) : "Unknown parser error";
  }

  const existing = await findByMessageId(db, mailbox, parsed.messageIdHeader);
  if (existing) {
    await env.MAIL_STORAGE.delete(rawObjectKey);
    return { status: "duplicate", messageId: existing };
  }

  const now = Date.now();
  const receivedAt = importedAt(parsed.date, now);
  const fromAddress = parsed.fromAddress ?? "";
  const sent = folder === "sent";
  // Only Cloudflare's own Authentication-Results counts, so imported mail is shown unverified.
  const authentication = parseAuthenticationResults(parsed.authenticationResults);
  const senderVerified = isVerifiedSender(authentication, fromAddress);
  const content = await analyzeContent({
    subject: parsed.subject,
    text: parsed.textBody,
    html: parsed.htmlBody,
    fromName: parsed.fromName,
    messageIdHeader: parsed.messageIdHeader,
    attachments: parsed.attachments,
    senderVerified,
  });

  try {
    await db.batch([
      db.insert(messages).values({
        id: messageId,
        inboxId: mailbox.id,
        accountId: mailbox.accountId,
        direction: sent ? "sent" : "received",
        recipients: sent ? parsed.toAddresses : null,
        messageIdHeader: parsed.messageIdHeader,
        fromAddress,
        fromName: parsed.fromName,
        ...searchColumns({ fromAddress, subject: parsed.subject }),
        toAddress: sent ? (parsed.toAddresses[0] ?? "") : mailbox.address,
        envelopeFrom: fromAddress,
        subject: parsed.subject,
        textBody: content.text,
        htmlBody: content.html,
        safeText: content.safeText,
        authentication,
        risk: content.risk,
        bodyTruncated: content.truncated,
        codes: [],
        links: content.links,
        sizeBytes: raw.rawSize,
        storedBytes: content.storedBytes,
        attachmentCount: parsed.attachments.length,
        rawObjectKey,
        parseError,
        bodyParsed,
        receivedAt,
        // Old mail is mail already read.
        readAt: receivedAt,
        box: folder === "archive" ? "archive" : null,
        movedAt: folder === "archive" ? now : null,
      }),
      ...parsed.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map((attachment) =>
        db.insert(attachments).values({
          id: createId("att"),
          messageId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          isInline: attachment.isInline,
          contentId: attachment.contentId,
          omitted: !plan.attachmentsEnabled,
        }),
      ),
      db
        .update(accounts)
        .set({ storedBytes: sql`${accounts.storedBytes} + ${content.storedBytes}` })
        .where(eq(accounts.id, mailbox.accountId)),
      db
        .update(inboxes)
        .set({
          messageCount: sql`${inboxes.messageCount} + 1`,
          rawBytes: sql`${inboxes.rawBytes} + ${raw.rawSize}`,
        })
        .where(eq(inboxes.id, mailbox.id)),
    ]);
  } catch (error) {
    await env.MAIL_STORAGE.delete(rawObjectKey);
    console.error("Failed to store an imported message", { error: error instanceof Error ? error.name : "unknown" });
    throw new ApiError("unavailable", "The message could not be stored.", { hint: "Try this file again." });
  }
  return { status: "imported", messageId };
}
