// Drafts of the personal mailbox: saved as the owner types, listed in the Drafts folder, and gone
// once sent or discarded. Files attached to a draft are uploads the cron keeps while the draft holds
// them; discarding the draft deletes them.
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { PERSONAL_ATTACHMENTS_MAX_FILES, PERSONAL_DRAFTS_MAX } from "../config";
import type { Database } from "../db/client";
import { type Inbox, mailDrafts, mailUploads } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { createId, isIdOf } from "../ids";
import { deleteUploads, findUploads, type MailUpload } from "./mail-uploads";

export type MailDraft = typeof mailDrafts.$inferSelect;

const MAX_DRAFT_TEXT_CHARS = 15_000;
const MAX_TYPED_RECIPIENTS = 50;

// Recipients are kept as typed, half-written ones included: they are only checked on sending.
const typedRecipients = z.array(z.string().trim().max(320)).max(MAX_TYPED_RECIPIENTS).default([]);
export const draftSchema = z.strictObject({
  to: typedRecipients,
  cc: typedRecipients,
  subject: z.string().max(998).default(""),
  text: z.string().max(MAX_DRAFT_TEXT_CHARS).default(""),
  inReplyTo: z
    .string()
    .max(64)
    .refine((id) => isIdOf("msg", id), "inReplyTo must be a message id.")
    .nullable()
    .default(null),
  attachments: z.array(z.string().max(64)).max(PERSONAL_ATTACHMENTS_MAX_FILES).default([]),
});
export type DraftInput = z.infer<typeof draftSchema>;

const iso = (timestamp: number) => new Date(timestamp).toISOString();

export function presentDraft(draft: MailDraft, files: MailUpload[]) {
  const byId = new Map(files.map((file) => [file.id, file]));
  return {
    id: draft.id,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    text: draft.text,
    inReplyTo: draft.inReplyTo,
    // Files the draft holds, in order; one removed since is simply left out.
    attachments: draft.attachments.flatMap((id) => {
      const file = byId.get(id);
      return file
        ? [{ id: file.id, filename: file.filename, contentType: file.contentType, sizeBytes: file.sizeBytes }]
        : [];
    }),
    createdAt: iso(draft.createdAt),
    updatedAt: iso(draft.updatedAt),
  };
}

/** The mailbox's uploads that drafts reference, for presenting them. */
export async function draftFiles(db: Database, mailbox: Pick<Inbox, "id">, drafts: MailDraft[]): Promise<MailUpload[]> {
  const ids = [...new Set(drafts.flatMap((draft) => draft.attachments))];
  if (ids.length === 0) return [];
  return db
    .select()
    .from(mailUploads)
    .where(and(eq(mailUploads.inboxId, mailbox.id), inArray(mailUploads.id, ids)));
}

export async function listDrafts(db: Database, mailbox: Pick<Inbox, "id">): Promise<MailDraft[]> {
  return db
    .select()
    .from(mailDrafts)
    .where(eq(mailDrafts.inboxId, mailbox.id))
    .orderBy(desc(mailDrafts.updatedAt), desc(mailDrafts.id))
    .limit(PERSONAL_DRAFTS_MAX);
}

export async function findDraft(db: Database, mailbox: Pick<Inbox, "id">, id: string): Promise<MailDraft> {
  if (!isIdOf("drf", id)) throw notFound("Draft");
  const [draft] = await db
    .select()
    .from(mailDrafts)
    .where(and(eq(mailDrafts.id, id), eq(mailDrafts.inboxId, mailbox.id)));
  if (!draft) throw notFound("Draft");
  return draft;
}

/** A draft may only hold files uploaded to the same mailbox. */
async function assertOwnFiles(db: Database, mailbox: Pick<Inbox, "id">, ids: string[]) {
  if (new Set(ids).size !== ids.length || !(await findUploads(db, mailbox, ids))) {
    throw new ApiError("validation_failed", "An attached file was not found.", {
      hint: "Upload it again: files that are not sent or kept in a draft are deleted after a day.",
    });
  }
}

export async function createDraft(db: Database, mailbox: Pick<Inbox, "id">, input: DraftInput): Promise<MailDraft> {
  const existing = await db.$count(mailDrafts, eq(mailDrafts.inboxId, mailbox.id));
  if (existing >= PERSONAL_DRAFTS_MAX) {
    throw new ApiError("plan_limit", `A mailbox keeps up to ${PERSONAL_DRAFTS_MAX} drafts.`, {
      hint: "Send or delete the drafts you no longer need.",
    });
  }
  await assertOwnFiles(db, mailbox, input.attachments);
  const now = Date.now();
  const [draft] = await db
    .insert(mailDrafts)
    .values({ id: createId("drf"), inboxId: mailbox.id, ...input, createdAt: now, updatedAt: now })
    .returning();
  if (!draft) throw new ApiError("internal_error", "The draft could not be saved.");
  return draft;
}

export async function updateDraft(db: Database, mailbox: Pick<Inbox, "id">, draft: MailDraft, input: DraftInput) {
  await assertOwnFiles(db, mailbox, input.attachments);
  const [updated] = await db
    .update(mailDrafts)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(mailDrafts.id, draft.id))
    .returning();
  return updated ?? draft;
}

/** Discards a draft with the files it still holds. */
export async function deleteDraft(
  env: { MAIL_STORAGE: R2Bucket },
  db: Database,
  mailbox: Pick<Inbox, "id">,
  draft: MailDraft,
) {
  const files = await draftFiles(db, mailbox, [draft]);
  await db.delete(mailDrafts).where(eq(mailDrafts.id, draft.id));
  await deleteUploads(env, db, files);
}
