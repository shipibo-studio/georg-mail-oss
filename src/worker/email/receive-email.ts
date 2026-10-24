// Receives email for the mail client's personal mailboxes (and, through extensions, for any other
// kind of inbox the hosted product adds). Unknown recipients and oversized mail are refused at SMTP
// time; everything accepted is parsed, checked and stored with its original in R2.
import { and, eq, gt, sql } from "drizzle-orm";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_HEADER_BLOCK_BYTES,
  MAX_LOGGED_ERROR_CHARS,
  PERSONAL_DUPLICATE_WINDOW_MS,
  PERSONAL_RAW_QUOTA_BYTES,
} from "../config";
import { createDatabase, type Database } from "../db/client";
import type { ExtractedLinkRecord, Inbox, MessageRisk, RiskLevel, SenderAuthentication } from "../db/schema";
import { accounts, attachments, inboxes, mailboxAliases, messages, plans } from "../db/schema";
import { createId } from "../ids";
import { searchColumns } from "../messages/text-folding";
import { PERSONAL_ROOT_PREFIX, RAW_ROOT_PREFIX, rawMessageKey } from "../storage/raw-messages";
import { analyzeContent } from "./analyze-content";
import { HeaderBlockCollector } from "./header-block";
import { type ParsedEmail, parseEmail } from "./parse-email";
import { isVerifiedSender, parseAuthenticationResults } from "./sender-authentication";
import { senderRuleFor } from "./sender-rules";
import { spamReasonFor } from "./spam-verdict";

export type RejectionReason =
  | "unknown_recipient"
  | "too_large"
  | "mailbox_full"
  | "over_quota"
  | "rate_limited"
  | "temporary_failure";

const SMTP_REPLIES: Record<RejectionReason, string> = {
  unknown_recipient: "550 5.1.1 Mailbox unavailable",
  too_large: "552 5.3.4 Message exceeds the size limit for this mailbox",
  mailbox_full: "452 4.2.2 Mailbox full",
  // Temporary on purpose: stored email expires, so a later retry can succeed.
  over_quota: "452 4.2.2 Account storage quota exceeded",
  rate_limited: "451 4.7.1 Too many messages for this mailbox, try again later",
  temporary_failure: "451 4.3.0 Temporary failure, try again later",
};

/** Facts about a stored email that are safe to report: counts and flags, never content. */
export interface StoredEmailFacts {
  sizeBytes: number;
  attachmentCount: number;
  hasCode: boolean;
  linkCount: number;
  senderVerified: boolean;
  parseFailed: boolean;
  riskLevel: RiskLevel;
}

export type InboundResult =
  | { status: "rejected"; code: RejectionReason; reason: string }
  // Personal mail that could not be stored (too large or over quota): only the owner's copy was sent.
  | { status: "forwarded"; accountId: string }
  // Personal mail already stored (a sender retrying the same Message-ID): accepted, not kept twice.
  | { status: "duplicate"; accountId: string; messageId: string }
  | {
      status: "stored";
      messageId: string;
      accountId: string;
      parseError: string | null;
      facts: StoredEmailFacts;
      /** Webhook deliveries queued for this message, to attempt right after the SMTP answer. */
      webhookDeliveryIds: string[];
    };

/** What another kind of inbox needs from this pipeline; the mail client alone passes none. */
export interface InboundExtensions {
  /** Whether a recipient that is not a personal mailbox can be one of these inboxes. */
  isOtherInboxAddress?(recipient: string, env: Env): boolean;
  /** Completes the codes and links the rules found, for plans that pay for it. */
  completeExtraction?(env: Env, input: ExtractionInput): Promise<Extraction>;
  /** Runs once a message to one of these inboxes is stored; returns webhook deliveries to attempt. */
  afterStored?(env: Env, db: Database, message: StoredMessage, inbox: Inbox): Promise<string[]>;
}

export interface ExtractionInput {
  /** The inbox's account, whose settings decide whether and how extraction is completed. */
  accountId: string;
  subject: string | null;
  visibleText: string | null;
  links: ExtractedLinkRecord[];
  codes: string[];
}

export interface Extraction {
  codes: string[];
  links: ExtractedLinkRecord[];
  extractedByAi: boolean;
}

/** What is known of a stored message without its content. */
export interface StoredMessage {
  id: string;
  accountId: string;
  fromAddress: string;
  authentication: SenderAuthentication | null;
  codes: string[];
  extractedByAi: boolean;
  risk: MessageRisk;
  attachmentCount: number;
  receivedAt: number;
}

/** Minimal surface of the Email Workers message, so the handler can be exercised in tests. */
export interface InboundEmail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  /** Forwards the original message to a verified address (Email Workers). */
  forward?(rcptTo: string): Promise<unknown>;
}

/** The mailbox address an alias belongs to, or the recipient itself when it is not an alias. */
async function aliasedMailboxAddress(db: Database, recipient: string): Promise<string> {
  const [alias] = await db
    .select({ address: inboxes.address })
    .from(mailboxAliases)
    .innerJoin(inboxes, eq(inboxes.id, mailboxAliases.inboxId))
    .where(eq(mailboxAliases.address, recipient))
    .limit(1);
  return alias?.address ?? recipient;
}

/** Addresses of personal mailboxes, from configuration, so mail to unknown names costs no query. */
export function personalMailboxAddresses(env: Pick<Env, "PERSONAL_MAILBOX_ADDRESSES">): Set<string> {
  return new Set(
    (env.PERSONAL_MAILBOX_ADDRESSES ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The owner's copy of personal mail. A failure is logged, never thrown, so the message is still stored. */
async function forwardCopy(email: InboundEmail, forwardTo: string | null): Promise<boolean> {
  if (!forwardTo || !email.forward) return false;
  try {
    await email.forward(forwardTo);
    return true;
  } catch (error) {
    // Email Routing's reason (an SMTP reply from the destination), never the message itself.
    console.warn("Could not forward personal mail", {
      error: error instanceof Error ? error.name : "unknown",
      reason: error instanceof Error ? error.message.slice(0, MAX_LOGGED_ERROR_CHARS) : null,
    });
    return false;
  }
}

const RAW_HTTP_METADATA = { httpMetadata: { contentType: "message/rfc822" } };

/** A message's bytes, from Email Routing or from an import. */
export type RawMessage = Pick<InboundEmail, "raw" | "rawSize">;

/** Reads the whole message, keeping the original in R2 first so a parser failure never loses it. */
export async function readMessage(
  email: RawMessage,
  bucket: R2Bucket,
  rawObjectKey: string | null,
): Promise<ArrayBuffer> {
  const raw = await new Response(email.raw).arrayBuffer();
  if (rawObjectKey) await bucket.put(rawObjectKey, raw, RAW_HTTP_METADATA);
  return raw;
}

/**
 * For mail too large to parse: streams the original to R2 untouched (copying costs almost no CPU)
 * and keeps only its header block, returned as a message with an empty body. One reader feeds
 * both, so nothing is buffered beyond the headers.
 */
export async function keepOriginalReadHeaders(
  email: RawMessage,
  bucket: R2Bucket,
  rawObjectKey: string,
): Promise<ArrayBuffer> {
  const { readable, writable } = new FixedLengthStream(email.rawSize);
  const upload = bucket.put(rawObjectKey, readable, RAW_HTTP_METADATA);
  const writer = writable.getWriter();
  // A failed copy is reported by close() below; this only keeps the rejection from going unhandled.
  writer.closed.catch(() => {});
  upload.catch(() => {});
  const reader = email.raw.getReader();
  const headers = new HeaderBlockCollector(MAX_HEADER_BLOCK_BYTES);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      headers.push(value);
      await writer.write(value);
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
  await upload;
  return headers.message();
}

/**
 * A message with this Message-ID already in the mailbox, received recently. Senders retry when a
 * delivery looks failed (for example, a forward was refused), and the owner should see it once.
 */
async function findRecentDuplicate(
  db: Database,
  inboxId: string,
  messageIdHeader: string | null,
  now: number,
): Promise<string | null> {
  if (!messageIdHeader) return null;
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.inboxId, inboxId),
        eq(messages.messageIdHeader, messageIdHeader),
        gt(messages.receivedAt, now - PERSONAL_DUPLICATE_WINDOW_MS),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

export function emptyParsedEmail(): ParsedEmail {
  return {
    date: null,
    toAddresses: [],
    messageIdHeader: null,
    fromAddress: null,
    fromName: null,
    subject: null,
    textBody: null,
    htmlBody: null,
    authenticationResults: null,
    codes: [],
    links: [],
    attachments: [],
  };
}

/**
 * Inbound limits per inbox, per account and per sending domain per inbox. The last one keeps a
 * flood from one sender from filling an inbox and blocking the code an agent is waiting for.
 */
async function withinInboundLimits(
  env: Env,
  inboxId: string,
  accountId: string,
  envelopeFrom: string,
): Promise<boolean> {
  const senderDomain = envelopeFrom.trim().toLowerCase().split("@").at(-1) || "unknown";
  const checks: [RateLimit, string][] = [
    [env.INBOUND_RATE_LIMITER, inboxId],
    [env.ACCOUNT_INBOUND_RATE_LIMITER, accountId],
    [env.SENDER_RATE_LIMITER, `${inboxId}:${senderDomain}`],
  ];
  for (const [limiter, key] of checks) {
    if (!(await limiter.limit({ key })).success) return false;
  }
  return true;
}

/** Characters of email the account keeps in D1, from the running counter (no scan of its messages). */
export async function accountStorageBytes(db: Database, accountId: string): Promise<number> {
  const [row] = await db.select({ storedBytes: accounts.storedBytes }).from(accounts).where(eq(accounts.id, accountId));
  return row?.storedBytes ?? 0;
}

/**
 * Accepts email only for existing, unexpired inboxes, within the plan's size and message limits.
 * Everything else is rejected at SMTP time, so unknown addresses never consume storage.
 */
export async function receiveEmail(
  email: InboundEmail,
  env: Env,
  extensions: InboundExtensions = {},
): Promise<InboundResult> {
  const reject = (code: RejectionReason): InboundResult => {
    const reason = SMTP_REPLIES[code];
    email.setReject(reason);
    return { status: "rejected", code, reason };
  };

  const recipient = email.to.trim().toLowerCase();
  const isPersonal = personalMailboxAddresses(env).has(recipient);
  // Addresses outside the inbox format (and not a configured personal mailbox) cannot exist, so
  // they are rejected without a query.
  if (!isPersonal && !extensions.isOtherInboxAddress?.(recipient, env)) return reject("unknown_recipient");

  const db = createDatabase(env.DB);
  const now = Date.now();
  // An alias delivers into its mailbox; the message keeps the address it was sent to.
  const inboxAddress = isPersonal ? await aliasedMailboxAddress(db, recipient) : recipient;
  const [target] = await db
    .select({ inbox: inboxes, plan: plans, storedBytes: accounts.storedBytes })
    .from(inboxes)
    .innerJoin(accounts, eq(accounts.id, inboxes.accountId))
    .innerJoin(plans, eq(plans.id, accounts.planId))
    .where(
      and(
        eq(inboxes.address, inboxAddress),
        gt(inboxes.expiresAt, now),
        eq(inboxes.kind, isPersonal ? "personal" : "disposable"),
      ),
    )
    .limit(1);

  if (!target) return reject("unknown_recipient");
  const { inbox, plan, storedBytes } = target;
  if (!(await withinInboundLimits(env, inbox.id, inbox.accountId, email.from))) return reject("rate_limited");
  // The owner's copy goes out first, so it does not depend on storing (or parsing) the message.
  const forwarded = isPersonal && (await forwardCopy(email, inbox.forwardEnabled ? inbox.forwardTo : null));
  // A personal message that cannot be stored is not refused when its copy already went out.
  const refuse = (reason: RejectionReason): InboundResult =>
    forwarded ? { status: "forwarded", accountId: inbox.accountId } : reject(reason);
  // Personal mail keeps every original in R2, within the mailbox's own quota.
  if (isPersonal && inbox.rawBytes + email.rawSize > PERSONAL_RAW_QUOTA_BYTES) return refuse("over_quota");
  // Too large to parse within the CPU limit. Checked before reading the body, so refused messages
  // cost nothing; personal mail is still kept, with its headers only and the original in R2.
  const bodyParsed = email.rawSize <= plan.maxMessageBytes;
  if (!bodyParsed && !isPersonal) return refuse("too_large");
  // Counters, not scans: every inbound email would otherwise read all of the account's messages.
  // A personal mailbox is limited by its storage quotas only.
  if (!isPersonal && inbox.messageCount >= plan.maxMessagesPerInbox) return reject("mailbox_full");
  // The raw size estimates what the parsed message will keep in D1 before paying to parse it.
  const estimatedBytes = bodyParsed ? email.rawSize : MAX_HEADER_BLOCK_BYTES;
  if (storedBytes + estimatedBytes > plan.maxStorageBytes) return refuse("over_quota");

  const messageId = createId("msg");
  // Paid plans keep the original (raw/, expired by a bucket lifecycle rule as a safety net);
  // personal mail always does, under personal/, which nothing expires.
  const keepsRaw = isPersonal || plan.attachmentsEnabled;
  const rawObjectKey = keepsRaw
    ? rawMessageKey(inbox.accountId, inbox.id, messageId, isPersonal ? PERSONAL_ROOT_PREFIX : RAW_ROOT_PREFIX)
    : null;
  let raw: ArrayBuffer;
  try {
    raw =
      bodyParsed || !rawObjectKey
        ? await readMessage(email, env.MAIL_STORAGE, rawObjectKey)
        : await keepOriginalReadHeaders(email, env.MAIL_STORAGE, rawObjectKey);
  } catch (error) {
    if (rawObjectKey) await env.MAIL_STORAGE.delete(rawObjectKey);
    console.error("Failed to keep inbound email", { error: error instanceof Error ? error.name : "unknown" });
    return refuse("temporary_failure");
  }

  let parsed = emptyParsedEmail();
  let parseError: string | null = null;
  try {
    parsed = await parseEmail(raw);
  } catch (error) {
    parseError = error instanceof Error ? error.message.slice(0, 500) : "Unknown parser error";
  }

  if (isPersonal) {
    const original = await findRecentDuplicate(db, inbox.id, parsed.messageIdHeader, now);
    if (original) {
      if (rawObjectKey) await env.MAIL_STORAGE.delete(rawObjectKey);
      return { status: "duplicate", accountId: inbox.accountId, messageId: original };
    }
  }

  const envelopeFrom = email.from.trim().toLowerCase();
  const authentication = parseAuthenticationResults(parsed.authenticationResults);
  const senderVerified = isVerifiedSender(authentication, parsed.fromAddress ?? envelopeFrom);
  const content = await analyzeContent({
    subject: parsed.subject,
    text: parsed.textBody,
    html: parsed.htmlBody,
    fromName: parsed.fromName,
    messageIdHeader: parsed.messageIdHeader,
    attachments: parsed.attachments,
    senderVerified,
  });
  const { risk } = content;
  // The rules first; an extension may complete them (Paid plan, never personal mail).
  const { codes, links, extractedByAi } =
    !isPersonal && plan.pdfTextEnabled && extensions.completeExtraction
      ? await extensions.completeExtraction(env, {
          accountId: inbox.accountId,
          subject: parsed.subject,
          visibleText: content.safeText,
          links: content.links,
          codes: parsed.codes,
        })
      : { codes: parsed.codes, links: content.links, extractedByAi: false };
  const storedBytesOfMessage = content.storedBytes;
  // Personal mail only: test inboxes keep everything, since agents read them by code.
  const spamReason = isPersonal
    ? spamReasonFor({
        senderRule: await senderRuleFor(db, inbox.id, parsed.fromAddress ?? envelopeFrom),
        authentication,
        senderVerified,
        risk,
      })
    : null;

  const messageRow = db.insert(messages).values({
    id: messageId,
    inboxId: inbox.id,
    accountId: inbox.accountId,
    messageIdHeader: parsed.messageIdHeader,
    fromAddress: parsed.fromAddress ?? envelopeFrom,
    fromName: parsed.fromName,
    ...searchColumns({ fromAddress: parsed.fromAddress ?? envelopeFrom, subject: parsed.subject }),
    toAddress: recipient,
    envelopeFrom,
    subject: parsed.subject,
    textBody: content.text,
    htmlBody: content.html,
    safeText: content.safeText,
    authentication,
    risk,
    bodyTruncated: content.truncated,
    codes,
    extractedByAi,
    links,
    sizeBytes: email.rawSize,
    storedBytes: storedBytesOfMessage,
    attachmentCount: parsed.attachments.length,
    rawObjectKey,
    parseError,
    bodyParsed,
    receivedAt: now,
    // Spam empties itself like Trash, counted from arrival.
    box: spamReason ? "spam" : null,
    movedAt: spamReason ? now : null,
    spamReason,
  });

  const attachmentRows = parsed.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map((attachment) =>
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
  );

  try {
    await db.batch([
      messageRow,
      ...attachmentRows,
      db
        .update(accounts)
        .set({ storedBytes: sql`${accounts.storedBytes} + ${storedBytesOfMessage}` })
        .where(eq(accounts.id, inbox.accountId)),
      db
        .update(inboxes)
        .set({
          messageCount: sql`${inboxes.messageCount} + 1`,
          rawBytes: sql`${inboxes.rawBytes} + ${isPersonal ? email.rawSize : 0}`,
        })
        .where(eq(inboxes.id, inbox.id)),
    ]);
  } catch (error) {
    // For example, the inbox was deleted between the lookup and the insert. Remove the orphaned raw
    // file and ask the sender to retry, so the email is neither lost silently nor left behind in R2.
    if (rawObjectKey) await env.MAIL_STORAGE.delete(rawObjectKey);
    console.error("Failed to store inbound email", { error: error instanceof Error ? error.name : "unknown" });
    return reject("temporary_failure");
  }
  const webhookDeliveryIds =
    isPersonal || !extensions.afterStored
      ? []
      : await extensions.afterStored(
          env,
          db,
          {
            id: messageId,
            accountId: inbox.accountId,
            fromAddress: parsed.fromAddress ?? envelopeFrom,
            authentication,
            codes,
            extractedByAi,
            risk,
            attachmentCount: parsed.attachments.length,
            receivedAt: now,
          },
          inbox,
        );
  return {
    status: "stored",
    webhookDeliveryIds,
    messageId,
    accountId: inbox.accountId,
    parseError,
    facts: {
      sizeBytes: raw.byteLength,
      attachmentCount: parsed.attachments.length,
      hasCode: codes.length > 0,
      linkCount: links.length,
      senderVerified,
      riskLevel: risk.level,
      parseFailed: parseError !== null,
    },
  };
}
