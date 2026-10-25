/** Longest a `wait` request may block before answering `{ timedOut: true }`. */
export const MAX_WAIT_SECONDS = 30;
export const DEFAULT_WAIT_SECONDS = 25;
/** How often `wait` checks D1 when the inbox's arrival notices are unavailable. */
export const WAIT_POLL_INTERVAL_MS = 1_000;
/**
 * Longest `wait` sleeps on an inbox's arrival notice before checking D1 anyway: it re-checks that
 * the key is still valid and catches a notice that was lost.
 */
export const WAIT_RECHECK_MS = 5_000;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_BATCH_INBOXES = 100;

/** Projects an account can own. Each project is a separate address namespace. */
export const MAX_PROJECTS_PER_ACCOUNT = 50;
/** Random lowercase letters appended to a project name to form its key ("loremipsum.ljkhiaug"). */
export const PROJECT_KEY_SUFFIX_LENGTH = 8;
/** Length of the label generated when an inbox is created without one. */
export const RANDOM_LABEL_LENGTH = 10;
/** Random characters appended to a batch label prefix ("signup-k3f9x2"). */
export const BATCH_LABEL_SUFFIX_LENGTH = 6;

/**
 * Stored body limits. postal-mime can expand a small email several times (it derives escaped HTML
 * from text), and D1 rows are capped at 2 MB, so bodies are truncated. Paid keeps the raw message.
 */
export const MAX_STORED_TEXT_CHARS = 100_000;
export const MAX_STORED_HTML_CHARS = 200_000;
/**
 * Attachment metadata rows stored per message; the total is kept in `attachment_count`. Low on
 * purpose: every row is a D1 write that any sender on the internet can trigger.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Text scanned for verification codes. Codes sit near the top; this bounds extraction CPU. */
export const MAX_CODE_SCAN_CHARS = 8_000;

/** Characters kept in message previews returned by list endpoints. */
export const PREVIEW_LENGTH = 200;
/** Maximum links extracted per message. */
export const MAX_LINKS_PER_MESSAGE = 20;

/**
 * API keys created through the API always expire: keys handed to agents end up in logs, transcripts
 * and commits, so a leaked key should stop working on its own.
 */
export const DEFAULT_API_KEY_TTL_SECONDS = 24 * 60 * 60;
/** Active (unrevoked, unexpired) keys per account. */
export const MAX_ACTIVE_KEYS_PER_ACCOUNT = 100;
/** Revoked and expired keys are deleted this long after they stop working. */
export const DEAD_KEY_RETENTION_DAYS = 30;
export const MIN_API_KEY_TTL_SECONDS = 60;
export const MAX_API_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;

/** `last_used_at` is refreshed at most this often per key, to avoid a D1 write on every request. */
export const API_KEY_TOUCH_INTERVAL_MS = 60_000;

/**
 * Mailbox providers where anyone can open an account: trusting the whole domain would trust every
 * stranger on it. Their users can still be trusted one address at a time.
 */
export const SHARED_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "fastmail.com",
  "tutanota.com",
  "hey.com",
]);

/**
 * Recipients a personal mailbox can send to per day. With the 100 verification emails a day, it
 * stays under Mailtrap's free quota of 150 emails a day.
 */
export const PERSONAL_SENDS_PER_DAY = 40;
/** Trash and Spam keep personal mail this long after it was moved there, then delete it. */
export const PERSONAL_BIN_RETENTION_DAYS = 30;
/**
 * Files attached to one personal message, together. Sending encodes them to base64 and wraps them
 * in the provider's JSON, a few milliseconds of CPU per 5 MB, so a send stays inside Workers Free.
 */
export const PERSONAL_ATTACHMENTS_MAX_BYTES = 5 * 1024 * 1024;
export const PERSONAL_ATTACHMENTS_MAX_FILES = 10;
/** Uploaded files waiting to be sent; more than this means the composer is being misused. */
export const PERSONAL_PENDING_UPLOADS_MAX = 20;
/** Drafts one personal mailbox keeps; more means something is creating them in a loop. */
export const PERSONAL_DRAFTS_MAX = 200;
/** Extra addresses one personal mailbox answers to. */
export const PERSONAL_ALIASES_MAX = 10;
/** Files uploaded but never sent are deleted after this long, unless a draft holds them. */
export const PERSONAL_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** A sender retrying a message it already delivered (same Message-ID) within this window is not stored twice. */
export const PERSONAL_DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Characters of a delivery error kept in the logs: enough for an SMTP reply, never the message. */
export const MAX_LOGGED_ERROR_CHARS = 300;
/** Original messages a personal mailbox keeps in R2 (R2's free tier is 10 GB). */
export const PERSONAL_RAW_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
/** Headers read from mail too large to parse: enough for long Received chains, a bounded cost. */
export const MAX_HEADER_BLOCK_BYTES = 64 * 1024;
/** Personal mailboxes never expire: 9999-12-31. */
export const PERSONAL_MAILBOX_EXPIRES_AT = 253_402_300_799_000;

/** Recipients per sent message (To, Cc and Bcc together): enough for transactional mail, not for bulk. */
export const MAX_RECIPIENTS_PER_MESSAGE = 10;
/** Sent-message records (idempotency keys and the daily cap) are kept this long. */
export const OUTBOUND_RETENTION_DAYS = 7;

/** Trusted senders per project. */
export const MAX_TRUSTED_SENDERS_PER_PROJECT = 20;
/** Verification emails an account can trigger per day: they go to arbitrary addresses. */
export const MAX_VERIFICATION_EMAILS_PER_DAY = 10;
/** For the whole service, below Mailtrap's free quota of 150 emails a day. */
export const MAX_VERIFICATION_EMAILS_PER_DAY_GLOBAL = 100;
/** Per recipient address across all accounts, so nobody can be flooded with verification emails. */
export const MAX_VERIFICATION_EMAILS_PER_RECIPIENT_PER_DAY = 3;
/** Wait before a verification email can be sent again to the same address. */
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 60 * 1000;
export const VERIFICATION_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Audit events are kept this long, then removed by the purge job. */
export const AUDIT_RETENTION_DAYS = 90;

/** Upper bound for JSON request bodies. */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

/**
 * Names that cannot be used as project names: real mailboxes routed by Cloudflare Email Routing
 * rules, RFC 2142 role accounts, and names that invite impersonation. Structured addresses already
 * keep inboxes from looking official; this list is a safety net for the most visible part.
 */
export const RESERVED_NAMES = new Set([
  "oi",
  "hola",
  "hello",
  "postmaster",
  "abuse",
  "admin",
  "administrator",
  "root",
  "hostmaster",
  "webmaster",
  "security",
  "support",
  "soporte",
  "help",
  "info",
  "billing",
  "noreply",
  "mailer-daemon",
  "georg",
  // Names the Georg app could use to announce releases (see ../georg-app/docs/infra-dominio.md).
  "updates",
  "update",
  "releases",
  "release",
  "download",
  "downloads",
  "app",
  "team",
  // georg-port, the family's app for ports and dev servers, may be distributed from dasgeorg.cc.
  "port",
  "ports",
]);

/**
 * Names starting with the brand followed by a non-letter ("georg-app", "georg1", "georg.team")
 * are reserved, so disposable inboxes cannot pose as official Georg addresses. Names that merely
 * start with the same letters ("georgia") stay available.
 */
export const RESERVED_BRAND_PATTERN = /^georg(?![a-z])/;

/** Mailtrap Email API endpoint for transactional sending (the same one the official SDK calls). */
export const MAILTRAP_SEND_URL = "https://send.api.mailtrap.io/api/send";
/** Resend's send endpoint (https://resend.com/docs/api-reference/emails/send-email). */
export const RESEND_SEND_URL = "https://api.resend.com/emails";
/** Provider error text echoed back in errors is capped, so a hostile response stays small. */
export const MAX_PROVIDER_ERROR_CHARS = 300;
/** Longest an outbound send may take before it is abandoned and reported as retryable. */
export const MAIL_SEND_TIMEOUT_MS = 10_000;
/** Each request to GitHub or GitLab while checking for or applying an update of the open-source mail client. */
export const UPDATE_FETCH_TIMEOUT_MS = 10_000;
/** How long the newest release, once looked up, is trusted before asking GitHub again. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Events stay queryable (GET /v1/events) and retryable for this long. */
export const EVENT_RETENTION_DAYS = 7;
export const MAX_WEBHOOKS_PER_ACCOUNT = 10;
/** Longest an endpoint may take to answer before the attempt counts as a timeout. */
export const WEBHOOK_TIMEOUT_MS = 5_000;
/** Wait before each retry after a failed attempt; a delivery fails for good after the last one. */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
/** Deliveries in a row that fail after every retry before the webhook is switched off. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 5;
/** Deliveries a cron run attempts, to stay inside the Worker's subrequest limit. */
export const WEBHOOK_DELIVERIES_PER_RUN = 25;
