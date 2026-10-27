import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// All timestamps are Unix epoch milliseconds stored as integers.

export const OUTBOUND_KINDS = ["internal", "reply", "personal"] as const;
export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

export const AUDIT_ACTIONS = [
  "message_read",
  "message_deleted",
  "inbox_created",
  "inbox_deleted",
  "project_created",
  "project_deleted",
  "key_created",
  "key_revoked",
  "keys_revoked_in_bulk",
  "trusted_sender_added",
  "trusted_sender_verified",
  "verification_email_sent",
  "messages_listed",
  "message_sent",
  "trusted_sender_removed",
  "webhook_created",
  "webhook_updated",
  "webhook_deleted",
  "notify_hook_created",
  "notify_hook_updated",
  "notify_hook_deleted",
  "notification_channel_updated",
  "ai_extraction_updated",
  "message_replied",
  "trusted_domain_proved",
  "reply_draft_proposed",
  "reply_draft_discarded",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Folders a personal message can be moved to, besides its natural Inbox or Sent. */
export const MAIL_BOXES = ["archive", "trash", "spam"] as const;
export type MailBox = (typeof MAIL_BOXES)[number];

/** Why a personal message is in Spam: the owner's rule, a forged From, risky mail from a stranger, or a report. */
export const SPAM_REASONS = ["blocked_sender", "failed_authentication", "high_risk", "reported"] as const;
export type SpamReason = (typeof SPAM_REASONS)[number];
export const SENDER_VERDICTS = ["block", "allow"] as const;
export type SenderVerdict = (typeof SENDER_VERDICTS)[number];

export const RISK_REASONS = [
  "hidden_content",
  "text_html_mismatch",
  "injection_phrases",
  "invisible_characters",
  "tag_characters",
  "lookalike_link",
  "link_text_mismatch",
  "risky_attachment",
  "unauthenticated_sender",
] as const;
export type RiskReason = (typeof RISK_REASONS)[number];
export type RiskLevel = "low" | "medium" | "high";

export interface MessageRisk {
  level: RiskLevel;
  reasons: RiskReason[];
}

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultTtlSeconds: integer("default_ttl_seconds").notNull(),
  maxTtlSeconds: integer("max_ttl_seconds").notNull(),
  maxActiveInboxes: integer("max_active_inboxes").notNull(),
  maxMessageBytes: integer("max_message_bytes").notNull(),
  // Caps the storage one inbox can consume; further email is rejected as "mailbox full".
  maxMessagesPerInbox: integer("max_messages_per_inbox").notNull().default(100),
  // Whether an inbox's lifetime can be extended past createdAt + maxTtlSeconds.
  extendable: integer("extendable", { mode: "boolean" }).notNull().default(false),
  attachmentsEnabled: integer("attachments_enabled", { mode: "boolean" }).notNull(),
  pdfTextEnabled: integer("pdf_text_enabled", { mode: "boolean" }).notNull(),
  sendsPerDay: integer("sends_per_day").notNull(),
  // Total size of stored email per account; further email is rejected until messages expire.
  maxStorageBytes: integer("max_storage_bytes").notNull().default(52_428_800),
  // Webhooks and notify hooks: outgoing notifications are a paid feature.
  hooksEnabled: integer("hooks_enabled", { mode: "boolean" }).notNull().default(false),
  // Replies to trusted senders: the one way an agent's email leaves Georg mail, so a paid feature.
  repliesEnabled: integer("replies_enabled", { mode: "boolean" }).notNull().default(false),
  // Replies an agent proposes for a person to approve (sending/reply-draft-routes.ts). Built but off
  // on every plan until the product decides to offer it: turning it on is an UPDATE, not a deploy.
  replyDraftsEnabled: integer("reply_drafts_enabled", { mode: "boolean" }).notNull().default(false),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  // Running total of messages.stored_bytes, so the quota check never scans every message.
  storedBytes: integer("stored_bytes").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// Where each resumable background job left off, so a bounded run continues where the last one
// stopped instead of sampling at random.
export const jobCursors = sqliteTable("job_cursors", {
  name: text("name").primaryKey(),
  position: text("position").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// People who may open the dashboard, by the email Cloudflare Access verified, and their account.
export const dashboardMembers = sqliteTable("dashboard_members", {
  email: text("email").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
});

// Display preferences of a person who opens the dashboard (theme, accent, language, time format,
// avatars), so they are the same on every device. Closed sets only; see dashboard/preferences.ts.
export const memberPreferences = sqliteTable("member_preferences", {
  email: text("email")
    .primaryKey()
    .references(() => dashboardMembers.email, { onDelete: "cascade" }),
  preferences: text("preferences", { mode: "json" }).$type<Record<string, string>>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Chosen by the owner; the address namespace is the key, so names may repeat across accounts.
    name: text("name").notNull(),
    // "{name}.{random letters}", the shared part of every inbox address in the project.
    key: text("key").notNull(),
    displayName: text("display_name"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_key_unique").on(table.key),
    index("projects_account_created_idx").on(table.accountId, table.createdAt),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // First characters of the key, shown in listings so keys can be told apart without revealing them.
    prefix: text("prefix").notNull(),
    // SHA-256 of the full key; the key itself is never stored.
    keyHash: text("key_hash").notNull(),
    canSend: integer("can_send", { mode: "boolean" }).notNull().default(false),
    // Administration: managing keys, projects, trusted senders and reading the audit trail. Only
    // keys created with direct database access have it by default; never give it to an agent.
    canManage: integer("can_manage", { mode: "boolean" }).notNull().default(false),
    // How much received content the key may read: "codes" (codes, links and metadata only), "safe"
    // (plus the sanitized text) or "full" (plus raw HTML, the original text part and the .eml).
    contentAccess: text("content_access", { enum: ["codes", "safe", "full"] })
      .notNull()
      .default("full"),
    // Keys handed to agents expire; null only for keys created with direct database access.
    expiresAt: integer("expires_at"),
    // When set, the key can only access this inbox.
    inboxId: text("inbox_id"),
    // When set, the key can only access this project and its inboxes.
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
    index("api_keys_account_idx").on(table.accountId),
  ],
);

export const inboxes = sqliteTable(
  "inboxes",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // "disposable" inboxes belong to projects and are what /v1 and MCP serve. A "personal" mailbox
    // (the owner's oi@) is real mail: only the dashboard session can read it, never an API key.
    kind: text("kind", { enum: ["disposable", "personal"] })
      .notNull()
      .default("disposable"),
    // Personal mailboxes only: a verified address that also receives a copy of every email.
    forwardTo: text("forward_to"),
    // Personal mailboxes only, switched from the dashboard: send the copy to forwardTo.
    forwardEnabled: integer("forward_enabled", { mode: "boolean" }).notNull().default(true),
    // Personal mailboxes only: bytes of original messages kept in R2, for their own quota.
    rawBytes: integer("raw_bytes").notNull().default(0),
    // Nullable only for inboxes created before projects existed; every new inbox has both.
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    label: text("label"),
    address: text("address").notNull(),
    displayName: text("display_name"),
    // Running count of the inbox's messages, for the per-inbox cap.
    messageCount: integer("message_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("inboxes_address_unique").on(table.address),
    index("inboxes_account_created_idx").on(table.accountId, table.createdAt),
    index("inboxes_expires_idx").on(table.expiresAt),
    index("inboxes_project_idx").on(table.projectId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Message-ID header, used later for threading.
    messageIdHeader: text("message_id_header"),
    // "sent" rows are copies of email the owner sent from a personal mailbox.
    direction: text("direction", { enum: ["received", "sent"] })
      .notNull()
      .default("received"),
    // Recipients of a sent message (To and Cc).
    recipients: text("recipients", { mode: "json" }).$type<string[]>(),
    // Message-ID this message replies to (In-Reply-To), for threads.
    inReplyTo: text("in_reply_to"),
    // Set when another inbox of the same project sent it through georg-mail: the sender is known
    // for certain. No foreign key, so the message keeps it after the sender inbox is deleted.
    internalSenderInboxId: text("internal_sender_inbox_id"),
    // From header: chosen by the sender and trivially forged. Display it, never trust it.
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    // From address and subject folded for case- and accent-insensitive filters in any script
    // (see messages/text-folding.ts). Null for messages stored before they existed.
    fromFolded: text("from_folded"),
    subjectFolded: text("subject_folded"),
    toAddress: text("to_address").notNull(),
    // SMTP envelope sender (MAIL FROM) as reported by Email Routing.
    envelopeFrom: text("envelope_from").notNull().default(""),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    // Text an agent may read: derived from the visible HTML, without hidden elements, comments or
    // invisible characters. Null for messages stored before it existed.
    safeText: text("safe_text"),
    // True when text or HTML was cut to the storage limit; the Paid plan keeps the full raw message.
    bodyTruncated: integer("body_truncated", { mode: "boolean" }).notNull().default(false),
    // Risk signals computed on arrival; null for messages stored before they existed.
    risk: text("risk", { mode: "json" }).$type<MessageRisk>(),
    // Sender authentication reported by Cloudflare (DKIM, SPF, DMARC); null when absent.
    authentication: text("authentication", { mode: "json" }).$type<SenderAuthentication>(),
    // JSON arrays produced by the extractors.
    codes: text("codes", { mode: "json" }).$type<string[]>().notNull(),
    // True when the code or the verification link came from the Workers AI fallback, not the rules:
    // still taken from the email itself, but a guess about which token is the code.
    extractedByAi: integer("extracted_by_ai", { mode: "boolean" }).notNull().default(false),
    links: text("links", { mode: "json" }).$type<ExtractedLinkRecord[]>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Characters this row keeps in D1 (bodies and safe text): what counts against the quota.
    storedBytes: integer("stored_bytes").notNull().default(0),
    // Total attachments in the email; only the first MAX_ATTACHMENTS_PER_MESSAGE get metadata rows.
    attachmentCount: integer("attachment_count").notNull().default(0),
    // R2 key of the raw .eml; null when the plan does not keep raw messages.
    rawObjectKey: text("raw_object_key"),
    // Set when the MIME parser failed; the message is still recorded so it is not silently lost.
    parseError: text("parse_error"),
    // False for personal mail too large to parse within the Worker's CPU limit: only its headers
    // were read, and the original is kept in R2 for download.
    bodyParsed: integer("body_parsed", { mode: "boolean" }).notNull().default(true),
    receivedAt: integer("received_at").notNull(),
    readAt: integer("read_at"),
    // Personal mail only: the folder it was moved to (null: its natural folder, Inbox or Sent) and
    // when, so Trash and Spam can empty themselves after PERSONAL_BIN_RETENTION_DAYS.
    box: text("box", { enum: MAIL_BOXES }),
    movedAt: integer("moved_at"),
    // Kept once set, so a message put back in Spam (Undo) still says why it went there first.
    spamReason: text("spam_reason", { enum: SPAM_REASONS }),
    // Personal mail only: its row in the message_search full-text index, set by a trigger (see
    // migration 0020), so deleting the message can remove its entry without scanning the index.
    searchRowid: integer("search_rowid"),
  },
  (table) => [
    index("messages_inbox_received_idx").on(table.inboxId, table.receivedAt),
    // wait polls for unread messages; this keeps each poll from reading the ones already read.
    index("messages_inbox_unread_idx").on(table.inboxId, table.receivedAt).where(sql`${table.readAt} IS NULL`),
    index("messages_account_idx").on(table.accountId),
    // Duplicate checks (a retried delivery, an import run twice) look a message up by its Message-ID.
    index("messages_inbox_message_id_idx").on(table.inboxId, table.messageIdHeader),
    // The cron empties Trash and Spam by date; moved mail is a small share of the table.
    uniqueIndex("messages_search_rowid_unique").on(table.searchRowid).where(sql`${table.searchRowid} IS NOT NULL`),
    index("messages_box_moved_idx").on(table.box, table.movedAt).where(sql`${table.box} IS NOT NULL`),
  ],
);

// Who did what, never with content: which key read, deleted or created what, and when.
// Rows outlive keys, projects and inboxes on purpose (no foreign keys besides the account), so the
// trail survives deletions; they expire after AUDIT_RETENTION_DAYS.
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id"),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    // Id of the affected message, inbox, project or key.
    targetId: text("target_id"),
    // For reads: the content view returned ("codes", "safe", "full", "raw").
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_events_account_created_idx").on(table.accountId, table.createdAt),
    index("audit_events_created_idx").on(table.createdAt),
  ],
);

export const EVENT_TYPES = ["message.received"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// What happened in an account, for clients that poll (GET /v1/events) and for webhooks that push.
// The payload is a "codes" view: ids, the verified sender domain, codes and risk, never sender text.
// Rows expire after EVENT_RETENTION_DAYS; they outlive the inbox on purpose, like the audit trail.
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    inboxId: text("inbox_id"),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("events_account_created_idx").on(table.accountId, table.createdAt, table.id),
    index("events_created_idx").on(table.createdAt),
  ],
);

// Endpoints that receive events as signed HTTPS POSTs. The signing secret is not stored: it is
// derived from the WEBHOOK_SIGNING_KEY Worker secret, the webhook id and secret_version.
export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Null: every project of the account.
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    eventTypes: text("event_types", { mode: "json" }).$type<EventType[]>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // Set when deliveries kept failing and the webhook was switched off.
    disabledReason: text("disabled_reason", { enum: ["failing"] }),
    secretVersion: integer("secret_version").notNull().default(1),
    // Deliveries in a row that ended failed after every retry; reset by any success.
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("webhooks_account_idx").on(table.accountId)],
);

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export const WEBHOOK_FAILURES = ["timeout", "network", "redirect", "http_status"] as const;

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    status: text("status", { enum: WEBHOOK_DELIVERY_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at"),
    // The endpoint's HTTP status of the last attempt, and why it failed (closed set, never a body).
    lastResponseStatus: integer("last_response_status"),
    lastFailure: text("last_failure", { enum: WEBHOOK_FAILURES }),
    createdAt: integer("created_at").notNull(),
    deliveredAt: integer("delivered_at"),
  },
  (table) => [
    index("webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt),
    index("webhook_deliveries_webhook_idx").on(table.webhookId, table.createdAt),
  ],
);

export const trustedSenders = sqliteTable(
  "trusted_senders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["domain", "address"] }).notNull(),
    // Lowercased domain or email address.
    value: text("value").notNull(),
    // Domains are active at once; addresses only after the owner confirms the verification email.
    verifiedAt: integer("verified_at"),
    // SHA-256 of the single-use verification token; cleared once used.
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: integer("verification_expires_at"),
    verificationSentAt: integer("verification_sent_at"),
    // Domains only: the owner proves control with a TXT record (dns-proof.ts). Replies to a sender
    // trusted by its domain need that proof; an address is proved by its verification email.
    dnsToken: text("dns_token"),
    dnsVerifiedAt: integer("dns_verified_at"),
    dnsCheckedAt: integer("dns_checked_at"),
    locale: text("locale", { enum: ["en", "es-419", "pt-BR"] })
      .notNull()
      .default("en"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trusted_senders_project_value_unique").on(table.projectId, table.kind, table.value),
    uniqueIndex("trusted_senders_token_unique").on(table.verificationTokenHash),
    index("trusted_senders_account_created_idx").on(table.accountId, table.createdAt),
  ],
);

/** Where a notify hook can deliver. New kinds plug in through the NotifyChannel interface. */
export const NOTIFY_CHANNELS = ["email", "slack"] as const;
export type NotifyChannelKind = (typeof NOTIFY_CHANNELS)[number];
export const NOTIFY_STATUSES = ["done", "failed", "info"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

export interface NotifyChannelResult {
  channel: NotifyChannelKind;
  state: "pending" | "sent" | "failed";
  attempts: number;
  /** The channel's HTTP status, when it answered. */
  responseStatus: number | null;
}

// The account's own notification channels, set once in the dashboard and used by every notify
// hook that picks them. Only kinds that need a secret live here; email goes to registered people.
export const accountChannels = sqliteTable(
  "account_channels",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["slack"] }).notNull(),
    // AES-GCM ciphertext of the channel's secret (a Slack incoming-webhook URL); never returned.
    secretEncrypted: text("secret_encrypted").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.kind] })],
);

// A link an agent calls when it is done, delivered to the owner's own channels (docs/notify-hooks.md).
export const notifyHooks = sqliteTable(
  "notify_hooks",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channels: text("channels", { mode: "json" }).$type<NotifyChannelKind[]>().notNull(),
    // A dashboard member of the account, never an address from the agent's request.
    emailTo: text("email_to"),
    // AES-GCM ciphertext of the Slack incoming-webhook URL; never returned.
    slackUrlEncrypted: text("slack_url_encrypted"),
    // SHA-256 of the link's token; the token itself is shown once.
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    // The token again, encrypted, so the owner can copy the link later; lookups use only the hash.
    tokenEncrypted: text("token_encrypted"),
    tokenExpiresAt: integer("token_expires_at").notNull(),
    maxDeliveries: integer("max_deliveries").notNull(),
    deliveriesCount: integer("deliveries_count").notNull().default(0),
    // Watchdog: when set, the cron tells the owner once if no notice arrived by then.
    deadlineAt: integer("deadline_at"),
    deadlineNotifiedAt: integer("deadline_notified_at"),
    // Language of the notices, the one the hook was created in.
    locale: text("locale", { enum: ["en", "es-419", "pt-BR"] })
      .notNull()
      .default("en"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    disabledReason: text("disabled_reason", { enum: ["quota", "owner"] }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (table) => [
    uniqueIndex("notify_hooks_token_unique").on(table.tokenHash),
    index("notify_hooks_account_idx").on(table.accountId, table.createdAt),
    index("notify_hooks_deadline_idx").on(table.deadlineAt).where(sql`${table.deadlineNotifiedAt} IS NULL`),
  ],
);

export const notifyDeliveries = sqliteTable(
  "notify_deliveries",
  {
    id: text("id").primaryKey(),
    hookId: text("hook_id")
      .notNull()
      .references(() => notifyHooks.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // "deadline": sent by the cron because the agent did not report in time.
    kind: text("kind", { enum: ["agent", "deadline"] }).notNull(),
    idempotencyKey: text("idempotency_key"),
    status: text("status", { enum: NOTIFY_STATUSES }).notNull(),
    // Written by the agent: cleaned, bounded and delivered as untrusted text.
    subject: text("subject"),
    detail: text("detail"),
    risk: text("risk", { mode: "json" }).$type<MessageRisk>().notNull(),
    channelResults: text("channel_results", { mode: "json" }).$type<NotifyChannelResult[]>().notNull(),
    // When a failed channel is tried again; null once every channel is settled.
    nextAttemptAt: integer("next_attempt_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("notify_deliveries_idempotency_unique").on(table.hookId, table.idempotencyKey),
    index("notify_deliveries_hook_idx").on(table.hookId, table.createdAt),
    index("notify_deliveries_due_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`),
    index("notify_deliveries_created_idx").on(table.createdAt),
  ],
);

// The owner's Spam / Not spam choices for a personal mailbox: mail from a blocked address goes to
// Spam, and mail from an allowed one skips the automatic checks (except a forged From).
export const senderRules = sqliteTable(
  "sender_rules",
  {
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    // Lowercased From address.
    address: text("address").notNull(),
    verdict: text("verdict", { enum: SENDER_VERDICTS }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.inboxId, table.address] })],
);

// More addresses of a personal mailbox (contact@, support@ beside hello@): mail to them lands in the
// same inbox, and the owner can send from them. Each must also be in PERSONAL_MAILBOX_ADDRESSES, so
// the operator still decides which addresses the install accepts.
export const mailboxAliases = sqliteTable(
  "mailbox_aliases",
  {
    // Lowercased; unique across every inbox and alias.
    address: text("address").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("mailbox_aliases_inbox_idx").on(table.inboxId)],
);

// Messages the owner is still writing, saved as they type so they survive a closed tab and show on
// every device. Recipients are kept as typed: they are checked only when the draft is sent.
export const mailDrafts = sqliteTable(
  "mail_drafts",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    to: text("to", { mode: "json" }).$type<string[]>().notNull(),
    cc: text("cc", { mode: "json" }).$type<string[]>().notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    // The message being answered, when the draft is a reply.
    inReplyTo: text("in_reply_to"),
    // Ids of uploads attached to the draft; the cron keeps them while the draft exists.
    attachments: text("attachments", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("mail_drafts_inbox_updated_idx").on(table.inboxId, table.updatedAt)],
);

// Files uploaded from the composer, waiting for their message to be sent. Sending turns them into
// the Sent copy's attachments; the cron deletes those never sent.
export const mailUploads = sqliteTable(
  "mail_uploads",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("mail_uploads_inbox_idx").on(table.inboxId), index("mail_uploads_created_idx").on(table.createdAt)],
);

// One row per send request: the idempotency record and the unit of the daily sending cap.
export const REPLY_DRAFT_STATUSES = ["pending", "sent", "discarded"] as const;
export type ReplyDraftStatus = (typeof REPLY_DRAFT_STATUSES)[number];

// Replies an agent proposes and a person approves in the dashboard before anything is sent
// (sending/reply-draft-routes.ts). The server fixes the recipient and subject when the draft is made.
export const replyDrafts = sqliteTable(
  "reply_drafts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    // The key that proposed it; kept as an id only, like the audit trail.
    apiKeyId: text("api_key_id"),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: REPLY_DRAFT_STATUSES }).notNull().default("pending"),
    // The reply sent once approved (outbound_messages.id).
    outboundId: text("outbound_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
  },
  (table) => [
    index("reply_drafts_inbox_status_idx").on(table.inboxId, table.status),
    index("reply_drafts_account_created_idx").on(table.accountId, table.createdAt),
  ],
);

export type ReplyDraft = typeof replyDrafts.$inferSelect;

export const outboundMessages = sqliteTable(
  "outbound_messages",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    // SHA-256 of the request body: the same key with a different body is a client error.
    requestHash: text("request_hash").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    // Delivered recipient addresses, returned again when the request is retried.
    recipients: text("recipients", { mode: "json" }).$type<string[]>().notNull(),
    // "internal": delivered to inboxes of the same project. "reply": an agent's reply sent out to a
    // trusted sender, counted against Georg mail's own daily budget with the email provider.
    // "personal": sent by the owner from the personal mailbox, with its own daily cap.
    kind: text("kind", { enum: OUTBOUND_KINDS }).notNull().default("internal"),
    createdAt: integer("created_at").notNull(),
    // Set once the message was delivered or handed to the provider. Until then a retry with the
    // same Idempotency-Key is told to wait (idempotency_key_in_flight) instead of getting an answer.
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("outbound_messages_inbox_key_unique").on(table.inboxId, table.idempotencyKey),
    index("outbound_messages_kind_created_idx").on(table.kind, table.createdAt),
    index("outbound_messages_account_created_idx").on(table.accountId, table.createdAt),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename"),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    isInline: integer("is_inline", { mode: "boolean" }).notNull(),
    contentId: text("content_id"),
    // True when the plan does not allow attachments: only the metadata is kept.
    omitted: integer("omitted", { mode: "boolean" }).notNull(),
    // Files the owner sent: kept as their own R2 object, since a sent copy has no original to parse.
    objectKey: text("object_key"),
  },
  (table) => [index("attachments_message_idx").on(table.messageId)],
);

export type AuthenticationResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "temperror" | "permerror";

export interface SenderAuthentication {
  dkim: { result: AuthenticationResult; domain: string | null }[];
  spf: { result: AuthenticationResult; domain: string | null } | null;
  dmarc: { result: AuthenticationResult; headerFrom: string | null } | null;
}

export interface ExtractedLinkRecord {
  url: string;
  isVerification: boolean;
}

export type Plan = typeof plans.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Inbox = typeof inboxes.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MailboxAlias = typeof mailboxAliases.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type OutboundRecord = typeof outboundMessages.$inferSelect;
export type TrustedSender = typeof trustedSenders.$inferSelect;
export type AccountEvent = typeof events.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// How an account's Paid plan completes the codes and links the rules miss: no row means no model
// sees its mail (the default). "workers-ai" uses Cloudflare's model; "byok" calls the provider the
// owner chose, with the owner's own API key (docs/plan.md, "AI provider per account").
export const AI_EXTRACTION_MODES = ["workers-ai", "byok"] as const;
export type AiExtractionMode = (typeof AI_EXTRACTION_MODES)[number];
export const AI_BYOK_PROVIDERS = ["anthropic", "openai"] as const;
export type AiByokProvider = (typeof AI_BYOK_PROVIDERS)[number];
/** Why a provider gave no answer, in words the owner can act on; never the provider's own message. */
export const AI_FAILURE_CODES = [
  "unauthorized",
  "rate_limited",
  "timeout",
  "unavailable",
  "bad_request",
  "bad_answer",
] as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[number];

export const accountAiSettings = sqliteTable("account_ai_settings", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: AI_EXTRACTION_MODES }).notNull(),
  // "byok" only: the provider, the model it is asked for, and the owner's API key (AES-GCM, never returned).
  provider: text("provider", { enum: AI_BYOK_PROVIDERS }),
  model: text("model"),
  apiKeyEncrypted: text("api_key_encrypted"),
  // The provider's health as the owner sees it in the dashboard: counts and codes, never content.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastFailureCode: text("last_failure_code", { enum: AI_FAILURE_CODES }),
  lastFailureAt: integer("last_failure_at"),
  lastSuccessAt: integer("last_success_at"),
  updatedAt: integer("updated_at").notNull(),
});
