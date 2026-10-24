// Shapes returned by /dashboard/api/mailbox (see src/worker/dashboard/mailbox-routes.ts).
export type RiskLevel = "low" | "medium" | "high";
export type RiskReason =
  | "hidden_content"
  | "text_html_mismatch"
  | "injection_phrases"
  | "invisible_characters"
  | "tag_characters"
  | "lookalike_link"
  | "link_text_mismatch"
  | "risky_attachment"
  | "unauthenticated_sender";

export interface Mailbox {
  address: string;
  /** More addresses of the mailbox: mail to them lands here, and it can send from them. */
  aliases: string[];
  /** Addresses the install accepts that the owner can still add as aliases. */
  claimableAliases: string[];
  displayName: string | null;
  owner: string;
  forwardTo: string | null;
  forwardEnabled: boolean;
  maxMessageBytes: number;
  sendsPerDay: number;
  /** Files attached to one message, together, and how many. */
  attachmentsMaxBytes: number;
  attachmentsMaxFiles: number;
  unread?: number;
}

export interface Sender {
  address: string | null;
  name: string | null;
  domain: string | null;
  verified: boolean;
  internal: boolean;
  trusted: boolean;
}

export interface MessageSummary {
  id: string;
  from: Sender;
  risk: { level: RiskLevel; reasons: RiskReason[] };
  codes: string[];
  /** Test inboxes only: the code came from the Workers AI fallback, not the rules. */
  extractedByAi?: boolean;
  attachmentCount: number;
  receivedAt: string;
  readAt: string | null;
  subject: string | null;
  preview: string | null;
  direction: "received" | "sent";
  recipients: string[] | null;
  /** Personal mail only: the folder it was moved to; null while it sits in Inbox or Sent. */
  box?: MailBox | null;
}

export type MailBox = "archive" | "trash" | "spam";
export type SenderVerdict = "block" | "allow";
export type SpamReason = "blocked_sender" | "failed_authentication" | "high_risk" | "reported";

export interface MessageLink {
  url: string;
  domain: string | null;
  isVerification: boolean;
  secure: boolean;
  privateTarget: boolean;
  fromVerifiedSender: boolean;
}

export interface Attachment {
  id: string;
  kind: string;
  sizeBytes: number;
  inline: boolean;
  filename: string | null;
  contentType: string | null;
}

export interface FullMessage extends MessageSummary {
  contentTrust: "untrusted";
  /** Personal mail in Spam: why it is there. */
  spamReason?: SpamReason | null;
  to: string;
  links: MessageLink[];
  attachments: Attachment[];
  sizeBytes: number;
  text: string | null;
  html?: string | null;
  bodyTruncated: boolean;
  parseFailed: boolean;
  /** False for mail too large to parse: only its headers were read. */
  bodyParsed: boolean;
  originalAvailable: boolean;
  attachmentsDownloadable: boolean;
}

export interface MessagePage {
  messages: MessageSummary[];
  nextCursor: string | null;
}

export interface SendRequest {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  /** One of the mailbox's aliases; the mailbox's own address when absent. */
  from?: string;
  /** Ids of files uploaded first, in order. */
  attachments?: string[];
  /** The draft this message was written in; sending deletes it. */
  draftId?: string;
}

export interface SavedDraft {
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  attachments: UploadedFile[];
  createdAt: string;
  updatedAt: string;
}

export type ImportFolder = "inbox" | "sent" | "archive";

export interface ImportResult {
  status: "imported" | "duplicate";
  messageId: string;
}

export interface UploadedFile {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface SendResult {
  id: string;
  recipients: string[];
  replayed: boolean;
}

/** First run of a self-hosted install: who Access signed in, and the addresses it may claim. */
export type SetupStatus =
  | { needed: false }
  | {
      needed: true;
      email: string;
      addresses: string[];
      /** False when the sign-in address is on a domain this install receives: a copy would loop. */
      canForward: boolean;
    };

export interface SetupRequest {
  address: string;
  displayName?: string;
  forward: boolean;
}
