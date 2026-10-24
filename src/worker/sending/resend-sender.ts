import { MAIL_SEND_TIMEOUT_MS, MAX_PROVIDER_ERROR_CHARS, RESEND_SEND_URL } from "../config";
import { type MailAddress, MailSendError, type MailSender, type OutboundMessage, type SendResult } from "./mail-sender";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
// Resend tags accept ASCII letters, digits, underscores and dashes only.
const TAG_UNSAFE_CHARACTERS = /[^A-Za-z0-9_-]/g;
// A display name goes inside a quoted header value: line breaks would start a new header.
const LINE_BREAKS = /[\r\n]+/g;

export interface ResendSenderOptions {
  apiKey: string;
  /** Injectable for tests; defaults to the runtime's fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** `"Name" <email>`, with the name quoted and escaped so it can never inject a header or a recipient. */
export function formatAddress(address: MailAddress): string {
  if (!address.name) return address.email;
  const name = address.name.replace(LINE_BREAKS, " ").replace(/["\\]/g, "\\$&").trim();
  return name ? `"${name}" <${address.email}>` : address.email;
}

function toResendBody(message: OutboundMessage) {
  return {
    from: formatAddress(message.from),
    to: message.to.map(formatAddress),
    ...(message.cc?.length ? { cc: message.cc.map(formatAddress) } : {}),
    subject: message.subject,
    ...(message.text !== undefined ? { text: message.text } : {}),
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((file) => ({
            filename: file.filename,
            content: file.content,
            content_type: file.contentType,
          })),
        }
      : {}),
    ...(message.category
      ? { tags: [{ name: "category", value: message.category.replace(TAG_UNSAFE_CHARACTERS, "_") }] }
      : {}),
  };
}

async function readJson(response: Response): Promise<{ id?: unknown; message?: unknown }> {
  try {
    return (await response.json()) as { id?: unknown; message?: unknown };
  } catch {
    return {};
  }
}

/** Sends through Resend's API. The key is only ever placed in the Authorization header. */
export function createResendSender(options: ResendSenderOptions): MailSender {
  if (!options.apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS;

  return {
    async send(message: OutboundMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_SEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(toResendBody(message)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new MailSendError("Resend could not be reached.", { status: null, retryable: true, cause: error });
      }

      const body = await readJson(response);
      if (!response.ok || typeof body.id !== "string") {
        const detail =
          typeof body.message === "string" ? body.message.slice(0, MAX_PROVIDER_ERROR_CHARS) : "no details";
        throw new MailSendError(`Resend rejected the email: ${detail}.`, {
          status: response.status,
          retryable: response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR_MIN,
        });
      }
      return { messageIds: [body.id] };
    },
  };
}
