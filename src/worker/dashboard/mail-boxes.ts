// Folders of a personal mailbox. A message lives in its natural folder (Inbox when received, Sent
// when sent) until the owner moves it to Archive, Trash or Spam; Trash and Spam empty themselves.
import { and, eq, inArray, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";
import { PERSONAL_BIN_RETENTION_DAYS } from "../config";
import { createDatabase, type Database } from "../db/client";
import { accounts, attachments, type Inbox, inboxes, type MailBox, type Message, messages } from "../db/schema";

export const MAIL_FOLDERS = ["inbox", "sent", "archive", "trash", "spam"] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Messages a cron run deletes from Trash and Spam; the rest go in later runs. */
const BIN_PURGE_BATCH = 100;
const EMPTIED_BOXES: MailBox[] = ["trash", "spam"];

/** The rows of one folder. */
export function folderCondition(folder: MailFolder): SQL | undefined {
  if (folder === "inbox") return and(eq(messages.direction, "received"), isNull(messages.box));
  if (folder === "sent") return and(eq(messages.direction, "sent"), isNull(messages.box));
  return eq(messages.box, folder);
}

/**
 * Deletes a personal message for good: its row, its original in R2, and what it counted against the
 * account's and the mailbox's storage.
 */
export async function deletePersonalMessage(env: { MAIL_STORAGE: R2Bucket }, db: Database, message: Message) {
  // Files the owner sent are kept on their own, next to the message.
  const files = await db
    .select({ objectKey: attachments.objectKey, sizeBytes: attachments.sizeBytes })
    .from(attachments)
    .where(and(eq(attachments.messageId, message.id), isNotNull(attachments.objectKey)));
  const keys = [message.rawObjectKey, ...files.map((file) => file.objectKey)].filter((key) => key !== null);
  if (keys.length > 0) await env.MAIL_STORAGE.delete(keys);
  const filesBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  await db.batch([
    db.delete(messages).where(eq(messages.id, message.id)),
    db
      .update(accounts)
      .set({ storedBytes: sql`max(0, ${accounts.storedBytes} - ${message.storedBytes})` })
      .where(eq(accounts.id, message.accountId)),
    db
      .update(inboxes)
      .set({
        messageCount: sql`max(0, ${inboxes.messageCount} - 1)`,
        rawBytes: sql`max(0, ${inboxes.rawBytes} - ${(message.rawObjectKey ? message.sizeBytes : 0) + filesBytes})`,
      })
      .where(eq(inboxes.id, message.inboxId)),
  ]);
}

/** Moves a message to a folder, or back to its natural one with `null`. */
export async function moveMessage(db: Database, mailbox: Pick<Inbox, "id">, messageId: string, box: MailBox | null) {
  await db
    .update(messages)
    .set({
      box,
      movedAt: box === null ? null : Date.now(),
      // A message the owner puts in Spam by hand was reported, unless it had already been filtered.
      ...(box === "spam" ? { spamReason: sql`coalesce(${messages.spamReason}, 'reported')` } : {}),
    })
    .where(and(eq(messages.id, messageId), eq(messages.inboxId, mailbox.id)));
}

/** The cron's share: personal mail that has been in Trash or Spam past the retention period. */
export async function emptyOldBins(env: Pick<Env, "DB" | "MAIL_STORAGE">, now = Date.now()): Promise<number> {
  const db = createDatabase(env.DB);
  const expired = await db
    .select()
    .from(messages)
    .where(and(inArray(messages.box, EMPTIED_BOXES), lt(messages.movedAt, now - PERSONAL_BIN_RETENTION_DAYS * DAY_MS)))
    .limit(BIN_PURGE_BATCH);
  for (const message of expired) await deletePersonalMessage(env, db, message);
  return expired.length;
}
