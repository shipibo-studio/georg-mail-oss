// Provider-neutral outbound email contract. Routes and jobs depend on this interface only, so the
// provider (Cloudflare Email Sending, Resend or Mailtrap) is a configuration choice: MAIL_PROVIDER.

export interface MailAddress {
  email: string;
  name?: string;
}

export interface OutboundAttachment {
  filename: string;
  contentType: string;
  /** The file, base64-encoded. */
  content: string;
}

export interface OutboundMessage {
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  /** Extra headers, such as In-Reply-To and References for replies. */
  headers?: Record<string, string>;
  text?: string;
  html?: string;
  attachments?: OutboundAttachment[];
  /** Provider-side label for grouping in logs and analytics, never shown to recipients. */
  category?: string;
}

export interface SendResult {
  /** Provider message ids (one per message or one per recipient, depending on the provider). */
  messageIds: string[];
}

export interface MailSender {
  send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * A failed send. `retryable` is true for rate limits, provider outages, timeouts and network errors,
 * where trying again later can succeed; false when the request itself was rejected.
 */
export class MailSendError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number | null; retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "MailSendError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}
