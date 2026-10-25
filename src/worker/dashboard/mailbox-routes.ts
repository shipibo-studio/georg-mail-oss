// The owner's personal mail client (oi@), behind the dashboard session. This is real mail: it is
// never reachable with an API key, and it is the only place that sends email to any recipient.
import { and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  MAX_RECIPIENTS_PER_MESSAGE,
  PERSONAL_ATTACHMENTS_MAX_BYTES,
  PERSONAL_ATTACHMENTS_MAX_FILES,
  PERSONAL_PENDING_UPLOADS_MAX,
  PERSONAL_RAW_QUOTA_BYTES,
  PERSONAL_SENDS_PER_DAY,
} from "../config";
import { sha256Hex } from "../crypto";
import type { Database } from "../db/client";
import {
  type Attachment,
  accounts,
  attachments,
  type Inbox,
  inboxes,
  MAIL_BOXES,
  type Message,
  mailDrafts,
  mailUploads,
  messages,
  outboundMessages,
  SENDER_VERDICTS,
} from "../db/schema";
import { normalizeAddress } from "../email/email-address";
import { threadableMessageId } from "../email/message-id";
import { setSenderRule } from "../email/sender-rules";
import { ApiError, notFound } from "../errors";
import { isUniqueViolation } from "../http/database-errors";
import { downloadHeaders, safeFilename } from "../http/downloads";
import type { MailEnv } from "../http/mail-env";
import { decodeCursor, encodeCursor, pageQuerySchema } from "../http/pagination";
import { validate } from "../http/validation";
import { createId, isIdOf } from "../ids";
import { attachmentBytes } from "../messages/attachment-content";
import { listAttachments, presentMessage, presentMessageSummary, summaryColumns } from "../messages/message-access";
import { searchColumns } from "../messages/text-folding";
import { createMailSender } from "../sending/create-mail-sender";
import type { OutboundAttachment } from "../sending/mail-sender";
import { addAlias, listAliases, mailboxAddresses, removeAlias, unclaimedAddresses } from "./mail-aliases";
import { deletePersonalMessage, folderCondition, MAIL_FOLDERS, moveMessage } from "./mail-boxes";
import {
  createDraft,
  deleteDraft,
  draftFiles,
  draftSchema,
  findDraft,
  listDrafts,
  presentDraft,
  updateDraft,
} from "./mail-drafts";
import { IMPORT_FOLDER_HEADER, IMPORT_FOLDERS, importMessage } from "./mail-import";
import { MAX_SEARCH_LENGTH, matchesSearch, searchMatchQuery } from "./mail-search";
import {
  cleanContentType,
  cleanFilename,
  deleteUploads,
  FILENAME_HEADER,
  findUploads,
  isBlockedFile,
  type MailUpload,
  pendingUploads,
  storeUpload,
  toBase64,
} from "./mail-uploads";
import { preferencesSchema, readPreferences, savePreferences } from "./preferences";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const MAX_PERSONAL_TEXT_CHARS = 15_000;
// A Message-ID copied from untrusted inbound mail goes into our own headers only when it has this shape.
const LINE_BREAK = /[\r\n]/;

type AppContext = Context<MailEnv>;

const addressList = z.array(z.string().trim().max(320)).max(MAX_RECIPIENTS_PER_MESSAGE);

const sendSchema = z
  .strictObject({
    to: addressList.min(1),
    cc: addressList.default([]),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine((subject) => !LINE_BREAK.test(subject), "The subject must be a single line."),
    text: z.string().min(1).max(MAX_PERSONAL_TEXT_CHARS),
    inReplyTo: z.string().max(64).optional(),
    // One of the mailbox's addresses (its own or an alias); its own when absent.
    from: z.string().trim().max(320).optional(),
    // The draft this message was written in: sending deletes it.
    draftId: z.string().max(64).optional(),
    // Files uploaded first to /uploads, in the order they are attached.
    attachments: z.array(z.string().max(64)).max(PERSONAL_ATTACHMENTS_MAX_FILES).default([]),
  })
  .refine((body) => new Set(body.attachments).size === body.attachments.length, "Each file can be attached once.")
  .refine(
    (body) => new Set([...body.to, ...body.cc]).size <= MAX_RECIPIENTS_PER_MESSAGE,
    `At most ${MAX_RECIPIENTS_PER_MESSAGE} recipients across to and cc.`,
  );

const settingsSchema = z
  .strictObject({ forwardEnabled: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, "Send forwardEnabled.");

const aliasSchema = z.strictObject({ address: z.string().trim().max(320) });

const listQuerySchema = pageQuerySchema.extend({ folder: z.enum(MAIL_FOLDERS).default("inbox") });
const searchSchema = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH),
  folder: z.enum(MAIL_FOLDERS).optional(),
});
const moveSchema = z.strictObject({
  // null puts a message back in its natural folder (Inbox or Sent).
  box: z.enum(MAIL_BOXES).nullable(),
  // Spam / Not spam also decide for the sender's future mail; null forgets the sender (Undo).
  sender: z.enum(SENDER_VERDICTS).nullable().optional(),
});
const messageIdParam = z.object({ messageId: z.string().max(64) });
const uploadIdParam = z.object({ uploadId: z.string().max(64) });
const draftIdParam = z.object({ draftId: z.string().max(64) });
const attachmentParam = z.object({ messageId: z.string().max(64), attachmentId: z.string().max(64) });

// Counted in recipients for this mailbox, in the same statement that records the send.
const RESERVE_PERSONAL_SEND = `
  INSERT INTO outbound_messages (id, account_id, inbox_id, idempotency_key, request_hash, recipient_count, recipients, kind, created_at)
  SELECT ?, ?, ?, ?, ?, ?, ?, 'personal', ?
  WHERE (SELECT coalesce(sum(recipient_count), 0) FROM outbound_messages WHERE inbox_id = ? AND created_at > ?) + ? <= ?`;

async function personalMailbox(context: AppContext): Promise<Inbox> {
  const [mailbox] = await context
    .get("db")
    .select()
    .from(inboxes)
    .where(and(eq(inboxes.accountId, context.get("dashboard").account.id), eq(inboxes.kind, "personal")))
    .limit(1);
  if (!mailbox) {
    throw new ApiError("not_found", "This account has no personal mailbox.", {
      hint: "Create one with `pnpm mailbox:create`.",
    });
  }
  return mailbox;
}

async function findMailboxMessage(context: AppContext, mailbox: Inbox, messageId: string): Promise<Message> {
  if (!isIdOf("msg", messageId)) throw notFound("Message");
  const [message] = await context
    .get("db")
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.inboxId, mailbox.id)))
    .limit(1);
  if (!message) throw notFound("Message");
  return message;
}

/** The owner sees everything, including the HTML, which the dashboard renders in a sandbox. */
function decodeFilename(header: string | undefined): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

function presentUpload(upload: MailUpload) {
  return { id: upload.id, filename: upload.filename, contentType: upload.contentType, sizeBytes: upload.sizeBytes };
}

/** The attached files, base64-encoded for the provider. */
async function readFiles(bucket: R2Bucket, uploads: MailUpload[]): Promise<OutboundAttachment[]> {
  return Promise.all(
    uploads.map(async (upload) => {
      const file = await bucket.get(upload.objectKey);
      if (!file) throw new Error("An uploaded file is missing from storage.");
      return {
        filename: upload.filename,
        contentType: upload.contentType,
        content: toBase64(new Uint8Array(await file.arrayBuffer())),
      };
    }),
  );
}

/** One page of a mailbox's messages matching `where`, newest first. */
async function listMessages(
  context: AppContext,
  mailbox: Inbox,
  where: SQL | undefined,
  limit: number,
  cursor: string | undefined,
) {
  const after = cursor ? decodeCursor(cursor) : undefined;
  const rows = await context
    .get("db")
    .select({ ...summaryColumns, direction: messages.direction, recipients: messages.recipients, box: messages.box })
    .from(messages)
    .where(
      and(
        eq(messages.inboxId, mailbox.id),
        where,
        after
          ? or(
              lt(messages.receivedAt, after.timestamp),
              and(eq(messages.receivedAt, after.timestamp), lt(messages.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.receivedAt), desc(messages.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    messages: page.map((row) => ({
      ...presentMessageSummary(row, "safe", []),
      direction: row.direction,
      recipients: row.recipients,
      box: row.box,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ timestamp: last.receivedAt, id: last.id }) : null,
  };
}

async function presentForOwner(context: AppContext, message: Message) {
  const attachmentRows = await listAttachments(context.get("db"), message.id);
  return {
    ...presentMessage(message, attachmentRows, { access: "full", include: new Set(["html"]), trustedSenders: [] }),
    direction: message.direction,
    recipients: message.recipients,
    box: message.box,
    spamReason: message.box === "spam" ? message.spamReason : null,
    bodyParsed: message.bodyParsed,
    originalAvailable: message.rawObjectKey !== null,
    attachmentsDownloadable: attachmentsDownloadable(context, message, attachmentRows),
  };
}

/**
 * Finding an attachment means parsing the original again, which only fits the Worker's CPU limit
 * for messages within the plan's parsing size. Larger ones are downloaded whole, as .eml.
 */
function attachmentsDownloadable(context: AppContext, message: Message, rows: Attachment[]): boolean {
  // Files the owner sent are kept on their own, ready to download.
  if (rows.length > 0 && rows.every((row) => row.objectKey !== null)) return true;
  return (
    message.bodyParsed &&
    message.rawObjectKey !== null &&
    message.sizeBytes <= context.get("dashboard").plan.maxMessageBytes
  );
}

async function readOriginal(context: AppContext, message: Message): Promise<R2ObjectBody> {
  const original = message.rawObjectKey ? await context.env.MAIL_STORAGE.get(message.rawObjectKey) : null;
  if (!original) throw notFound("Original message");
  return original;
}

/** Reserves the send in the same statement that checks the daily cap, so parallel sends cannot exceed it. */
async function reservePersonalSend(
  context: AppContext,
  bindings: (string | number)[],
): Promise<"reserved" | "duplicate" | "over_limit"> {
  try {
    const result = await context.env.DB.prepare(RESERVE_PERSONAL_SEND)
      .bind(...bindings)
      .run();
    return (result.meta.changes ?? 0) > 0 ? "reserved" : "over_limit";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

/** The mailbox, its addresses and its delivery settings, as the dashboard shows them. */
async function presentMailbox(context: AppContext, mailbox: Inbox) {
  const session = context.get("dashboard");
  const db = context.get("db");
  return {
    address: mailbox.address,
    aliases: await listAliases(db, mailbox.id),
    // Configured addresses the owner may still add as aliases.
    claimableAliases: await unclaimedAddresses(context.env, db),
    // The signed-in person's display preferences, null until they change one.
    preferences: await readPreferences(db, session.email),
    displayName: mailbox.displayName,
    owner: session.email,
    forwardTo: mailbox.forwardTo,
    forwardEnabled: mailbox.forwardTo !== null && mailbox.forwardEnabled,
    maxMessageBytes: session.plan.maxMessageBytes,
    sendsPerDay: PERSONAL_SENDS_PER_DAY,
    attachmentsMaxBytes: PERSONAL_ATTACHMENTS_MAX_BYTES,
    attachmentsMaxFiles: PERSONAL_ATTACHMENTS_MAX_FILES,
  };
}

/** The address a message goes out from: the mailbox's own, or one of its aliases when asked. */
async function senderAddress(db: Database, mailbox: Inbox, requested: string | undefined): Promise<string> {
  if (!requested) return mailbox.address;
  const address = requested.toLowerCase();
  if (!(await mailboxAddresses(db, mailbox)).includes(address)) {
    throw new ApiError("validation_failed", `${requested} is not an address of this mailbox.`, {
      hint: "Send from the mailbox's address or one of its aliases.",
    });
  }
  return address;
}

function readIdempotencyKey(context: AppContext): string {
  const key = context.req.header("Idempotency-Key")?.trim();
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError("validation_failed", "Sending needs an Idempotency-Key header.");
  }
  return key;
}

/**
 * What the hosted product adds to the mail client without the mail client knowing about it: the
 * open-source edition passes none.
 */
export interface MailboxHooks {
  /** A personal message went out; the hosted product records it in the audit trail. */
  onSent?(db: Database, accountId: string, outboundId: string): Promise<void>;
}

export const createMailboxRoutes = (hooks: MailboxHooks = {}) =>
  new Hono<MailEnv>()
    .get("/", async (context) => {
      const mailbox = await personalMailbox(context);
      const [unread] = await context
        .get("db")
        .select({ total: sql<number>`count(*)` })
        .from(messages)
        .where(and(eq(messages.inboxId, mailbox.id), folderCondition("inbox"), sql`${messages.readAt} IS NULL`));
      return context.json({
        ...(await presentMailbox(context, mailbox)),
        unread: Number(unread?.total ?? 0),
      });
    })

    .patch("/", validate("json", settingsSchema), async (context) => {
      const mailbox = await personalMailbox(context);
      const changes = context.req.valid("json");
      // Forwarding needs an address; without one the switch stays off.
      const forwardEnabled = mailbox.forwardTo ? (changes.forwardEnabled ?? mailbox.forwardEnabled) : false;
      await context.get("db").update(inboxes).set({ forwardEnabled }).where(eq(inboxes.id, mailbox.id));
      return context.json(await presentMailbox(context, { ...mailbox, forwardEnabled }));
    })

    .put("/preferences", validate("json", preferencesSchema), async (context) => {
      const { email } = context.get("dashboard");
      return context.json(await savePreferences(context.get("db"), email, context.req.valid("json")));
    })

    .post("/aliases", validate("json", aliasSchema), async (context) => {
      const mailbox = await personalMailbox(context);
      const address = await addAlias(context.env, context.get("db"), mailbox, context.req.valid("json").address);
      return context.json({ address }, 201);
    })

    .delete("/aliases/:address", async (context) => {
      const mailbox = await personalMailbox(context);
      await removeAlias(context.get("db"), mailbox, context.req.param("address"));
      return context.body(null, 204);
    })

    .get("/messages", validate("query", listQuerySchema), async (context) => {
      const mailbox = await personalMailbox(context);
      const { folder, limit, cursor } = context.req.valid("query");
      return context.json(await listMessages(context, mailbox, folderCondition(folder), limit, cursor));
    })

    // POST so the search terms stay out of URLs and request logs; it changes nothing.
    .post("/messages/search", validate("json", searchSchema), async (context) => {
      const mailbox = await personalMailbox(context);
      const { q, folder, limit, cursor } = context.req.valid("json");
      const matchQuery = searchMatchQuery(q);
      if (!matchQuery) return context.json({ messages: [], nextCursor: null });
      // Everywhere but Spam and Trash unless a folder is given, as in other mail clients.
      const where = and(
        matchesSearch(matchQuery),
        folder ? folderCondition(folder) : or(isNull(messages.box), eq(messages.box, "archive")),
      );
      return context.json(await listMessages(context, mailbox, where, limit, cursor));
    })

    .get("/messages/:messageId", validate("param", messageIdParam), async (context) => {
      const mailbox = await personalMailbox(context);
      const message = await findMailboxMessage(context, mailbox, context.req.valid("param").messageId);
      if (message.readAt === null) {
        await context.get("db").update(messages).set({ readAt: Date.now() }).where(eq(messages.id, message.id));
      }
      return context.json(await presentForOwner(context, { ...message, readAt: message.readAt ?? Date.now() }));
    })

    .post("/messages", validate("json", sendSchema), async (context) => {
      const db = context.get("db");
      const session = context.get("dashboard");
      const mailbox = await personalMailbox(context);
      const idempotencyKey = readIdempotencyKey(context);
      const body = context.req.valid("json");
      const to = body.to.map(normalizeAddress);
      const cc = body.cc.map(normalizeAddress);
      const recipients = [...new Set([...to, ...cc])];
      const from = await senderAddress(db, mailbox, body.from);
      const parent = body.inReplyTo ? await findMailboxMessage(context, mailbox, body.inReplyTo) : null;
      const uploads = await findUploads(db, mailbox, body.attachments);
      if (!uploads) {
        throw new ApiError("validation_failed", "An attached file was not found.", {
          hint: "Upload it again: files that are not sent within a day are deleted.",
        });
      }
      const filesBytes = uploads.reduce((total, upload) => total + upload.sizeBytes, 0);
      if (filesBytes > PERSONAL_ATTACHMENTS_MAX_BYTES) {
        throw new ApiError("payload_too_large", `Attachments are limited to ${PERSONAL_ATTACHMENTS_MAX_BYTES} bytes.`);
      }
      const requestHash = await sha256Hex(JSON.stringify(body));

      const [previous] = await db
        .select()
        .from(outboundMessages)
        .where(and(eq(outboundMessages.inboxId, mailbox.id), eq(outboundMessages.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw new ApiError("conflict", "This Idempotency-Key was already used for a different message.");
        }
        return context.json({ id: previous.id, recipients: previous.recipients, replayed: true });
      }

      const now = Date.now();
      const outboundId = createId("out");
      const reserved = await reservePersonalSend(context, [
        outboundId,
        session.account.id,
        mailbox.id,
        idempotencyKey,
        requestHash,
        recipients.length,
        JSON.stringify(recipients),
        now,
        mailbox.id,
        now - DAY_MS,
        recipients.length,
        PERSONAL_SENDS_PER_DAY,
      ]);
      if (reserved === "duplicate") {
        throw new ApiError("conflict", "A message with this Idempotency-Key is being sent.", {
          hint: "Retry with the same key in a moment to get its result.",
        });
      }
      if (reserved === "over_limit") {
        throw new ApiError("rate_limited", `A personal mailbox sends to ${PERSONAL_SENDS_PER_DAY} recipients a day.`, {
          hint: "Try again tomorrow.",
        });
      }

      const parentMessageId = threadableMessageId(parent?.messageIdHeader);
      const threadHeaders: Record<string, string> = parentMessageId
        ? { "In-Reply-To": parentMessageId, References: parentMessageId }
        : {};
      try {
        const files = await readFiles(context.env.MAIL_STORAGE, uploads);
        await createMailSender(context.env).send({
          from: { email: from, ...(mailbox.displayName ? { name: mailbox.displayName } : {}) },
          to: to.map((email) => ({ email })),
          ...(cc.length > 0 ? { cc: cc.map((email) => ({ email })) } : {}),
          subject: body.subject,
          text: body.text,
          ...(Object.keys(threadHeaders).length > 0 ? { headers: threadHeaders } : {}),
          ...(files.length > 0 ? { attachments: files } : {}),
          category: "Personal",
        });
      } catch (error) {
        await db.delete(outboundMessages).where(eq(outboundMessages.id, outboundId));
        console.error("Personal email failed", { error: error instanceof Error ? error.name : "unknown" });
        throw new ApiError("unavailable", "The email could not be sent.", { hint: "Try again in a few minutes." });
      }

      // The Sent copy is the owner's own text: stored as written, counted against the storage quota.
      const storedBytes = body.text.length * 2;
      const messageId = createId("msg");
      await db.batch([
        db.insert(messages).values({
          id: messageId,
          inboxId: mailbox.id,
          accountId: session.account.id,
          direction: "sent",
          recipients,
          messageIdHeader: null,
          inReplyTo: parentMessageId,
          fromAddress: from,
          fromName: mailbox.displayName,
          ...searchColumns({ fromAddress: from, subject: body.subject }),
          toAddress: to[0] ?? "",
          envelopeFrom: from,
          subject: body.subject,
          textBody: body.text,
          htmlBody: null,
          safeText: body.text,
          risk: { level: "low", reasons: [] },
          codes: [],
          links: [],
          sizeBytes: body.text.length + filesBytes,
          storedBytes,
          attachmentCount: uploads.length,
          receivedAt: now,
          readAt: now,
        }),
        // The uploaded files become the Sent copy's attachments, where they already are in R2.
        ...uploads.map((upload) =>
          db.insert(attachments).values({
            id: createId("att"),
            messageId,
            filename: upload.filename,
            contentType: upload.contentType,
            sizeBytes: upload.sizeBytes,
            isInline: false,
            contentId: null,
            omitted: false,
            objectKey: upload.objectKey,
          }),
        ),
        ...(body.draftId
          ? [db.delete(mailDrafts).where(and(eq(mailDrafts.id, body.draftId), eq(mailDrafts.inboxId, mailbox.id)))]
          : []),
        ...(uploads.length > 0
          ? [
              db.delete(mailUploads).where(
                inArray(
                  mailUploads.id,
                  uploads.map((upload) => upload.id),
                ),
              ),
            ]
          : []),
        db
          .update(accounts)
          .set({ storedBytes: sql`${accounts.storedBytes} + ${storedBytes}` })
          .where(eq(accounts.id, session.account.id)),
        db
          .update(inboxes)
          .set({ messageCount: sql`${inboxes.messageCount} + 1`, rawBytes: sql`${inboxes.rawBytes} + ${filesBytes}` })
          .where(eq(inboxes.id, mailbox.id)),
      ]);
      await hooks.onSent?.(db, session.account.id, outboundId);
      return context.json({ id: outboundId, recipients, replayed: false }, 201);
    })

    .get("/drafts", async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const drafts = await listDrafts(db, mailbox);
      const files = await draftFiles(db, mailbox, drafts);
      return context.json({ drafts: drafts.map((draft) => presentDraft(draft, files)) });
    })

    .post("/drafts", validate("json", draftSchema), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const draft = await createDraft(db, mailbox, context.req.valid("json"));
      return context.json(presentDraft(draft, await draftFiles(db, mailbox, [draft])), 201);
    })

    .get("/drafts/:draftId", validate("param", draftIdParam), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const draft = await findDraft(db, mailbox, context.req.valid("param").draftId);
      return context.json(presentDraft(draft, await draftFiles(db, mailbox, [draft])));
    })

    .put("/drafts/:draftId", validate("param", draftIdParam), validate("json", draftSchema), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const draft = await findDraft(db, mailbox, context.req.valid("param").draftId);
      const updated = await updateDraft(db, mailbox, draft, context.req.valid("json"));
      return context.json(presentDraft(updated, await draftFiles(db, mailbox, [updated])));
    })

    .delete("/drafts/:draftId", validate("param", draftIdParam), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const draft = await findDraft(db, mailbox, context.req.valid("param").draftId);
      await deleteDraft(context.env, db, mailbox, draft);
      return context.body(null, 204);
    })

    .post("/uploads", async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const declaredBytes = Number(context.req.header("Content-Length"));
      if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
        throw new ApiError("validation_failed", "Send the file as the request body, with its Content-Length.");
      }
      const filename = cleanFilename(decodeFilename(context.req.header(FILENAME_HEADER)));
      if (isBlockedFile(filename)) {
        throw new ApiError("validation_failed", "This type of file cannot be sent by email.", {
          hint: "Mail services refuse programs and scripts; share it through a link instead.",
        });
      }
      const pending = await pendingUploads(db, mailbox);
      if (pending.length >= PERSONAL_PENDING_UPLOADS_MAX) {
        throw new ApiError("plan_limit", `Up to ${PERSONAL_PENDING_UPLOADS_MAX} files can wait to be sent.`, {
          hint: "Send or remove the files already attached.",
        });
      }
      const pendingBytes = pending.reduce((total, upload) => total + upload.sizeBytes, 0);
      if (mailbox.rawBytes + pendingBytes + declaredBytes > PERSONAL_RAW_QUOTA_BYTES) {
        throw new ApiError("plan_limit", "The mailbox's storage is full.", { hint: "Delete old mail to make room." });
      }
      const bytes = await context.req.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > PERSONAL_ATTACHMENTS_MAX_BYTES) {
        throw new ApiError("validation_failed", "The file is empty or too large.");
      }
      const upload = await storeUpload(context.env, db, mailbox, {
        filename,
        contentType: cleanContentType(context.req.header("Content-Type")),
        bytes,
      });
      return context.json(presentUpload(upload), 201);
    })

    .post("/imports", async (context) => {
      const mailbox = await personalMailbox(context);
      const folder = IMPORT_FOLDERS.find((name) => name === context.req.header(IMPORT_FOLDER_HEADER));
      if (!folder) {
        throw new ApiError("validation_failed", `Set ${IMPORT_FOLDER_HEADER} to ${IMPORT_FOLDERS.join(", ")}.`);
      }
      const rawSize = Number(context.req.header("Content-Length"));
      const body = context.req.raw.body;
      if (!Number.isInteger(rawSize) || rawSize <= 0 || !body) {
        throw new ApiError(
          "validation_failed",
          "Send one message (.eml) as the request body, with its Content-Length.",
        );
      }
      const result = await importMessage(
        context.env,
        context.get("db"),
        mailbox,
        context.get("dashboard").plan,
        { raw: body, rawSize },
        folder,
      );
      return context.json(result, result.status === "imported" ? 201 : 200);
    })

    .delete("/uploads/:uploadId", validate("param", uploadIdParam), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const found = await findUploads(db, mailbox, [context.req.valid("param").uploadId]);
      if (!found) throw notFound("Upload");
      await deleteUploads(context.env, db, found);
      return context.body(null, 204);
    })

    .get("/messages/:messageId/original", validate("param", messageIdParam), async (context) => {
      const mailbox = await personalMailbox(context);
      const message = await findMailboxMessage(context, mailbox, context.req.valid("param").messageId);
      const original = await readOriginal(context, message);
      // Streamed straight from R2: downloading even a 25 MB message costs almost no CPU.
      return new Response(original.body, { headers: downloadHeaders(`${message.id}.eml`) });
    })

    .get("/messages/:messageId/attachments/:attachmentId", validate("param", attachmentParam), async (context) => {
      const mailbox = await personalMailbox(context);
      const { messageId, attachmentId } = context.req.valid("param");
      const message = await findMailboxMessage(context, mailbox, messageId);
      const rows = await listAttachments(context.get("db"), message.id);
      const row = rows.find((attachment) => attachment.id === attachmentId);
      if (!row) throw notFound("Attachment");
      const headers = downloadHeaders(safeFilename(row.filename, `${row.id}.bin`));
      if (row.objectKey) {
        const file = await context.env.MAIL_STORAGE.get(row.objectKey);
        if (!file) throw notFound("Attachment");
        return new Response(file.body, { headers });
      }
      if (!attachmentsDownloadable(context, message, rows)) {
        throw new ApiError("unavailable", "This attachment can only be read from the original message.", {
          hint: "Download the original (.eml) and open it in your mail app.",
        });
      }
      const content = await attachmentBytes(await (await readOriginal(context, message)).arrayBuffer(), rows, row);
      if (!content) throw notFound("Attachment");
      return new Response(content, { headers });
    })

    .delete("/messages/:messageId", validate("param", messageIdParam), async (context) => {
      const db = context.get("db");
      const mailbox = await personalMailbox(context);
      const message = await findMailboxMessage(context, mailbox, context.req.valid("param").messageId);
      // Deleting for good; the dashboard moves to Trash first and only deletes from there.
      await deletePersonalMessage(context.env, db, message);
      return context.body(null, 204);
    })

    .patch("/messages/:messageId", validate("param", messageIdParam), validate("json", moveSchema), async (context) => {
      const mailbox = await personalMailbox(context);
      const message = await findMailboxMessage(context, mailbox, context.req.valid("param").messageId);
      const { box, sender } = context.req.valid("json");
      const db = context.get("db");
      if (sender !== undefined && message.direction !== "received") {
        throw new ApiError("validation_failed", "Only received mail has a sender to block or allow.");
      }
      // The rule it replaced comes back, so the dashboard can undo both the move and the rule.
      const previousSender =
        sender === undefined ? undefined : await setSenderRule(db, mailbox.id, message.fromAddress, sender);
      await moveMessage(db, mailbox, message.id, box);
      return context.json({ id: message.id, box, ...(sender === undefined ? {} : { sender, previousSender }) });
    });
