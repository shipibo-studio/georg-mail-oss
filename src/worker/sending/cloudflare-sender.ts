import { MAX_PROVIDER_ERROR_CHARS } from "../config";
import { type MailAddress, MailSendError, type MailSender, type OutboundMessage, type SendResult } from "./mail-sender";

// Errors where the same request can succeed later. Anything without a code is an outage too.
const RETRYABLE_ERROR_CODES = new Set(["E_RATE_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR"]);

/** The binding's address form: a plain address, or address and name together. */
function toBindingAddress(address: MailAddress): string | EmailAddress {
  return address.name ? { email: address.email, name: address.name } : address.email;
}

function toBuilder(message: OutboundMessage): EmailMessageBuilder {
  return {
    from: toBindingAddress(message.from),
    to: message.to.map(toBindingAddress),
    ...(message.cc?.length ? { cc: message.cc.map(toBindingAddress) } : {}),
    subject: message.subject,
    ...(message.text !== undefined ? { text: message.text } : {}),
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((file) => ({
            content: file.content,
            filename: file.filename,
            type: file.contentType,
            disposition: "attachment" as const,
          })),
        }
      : {}),
  };
}

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Sends through Cloudflare Email Sending with the Worker's `send_email` binding: no API key, and the
 * sending domain must be onboarded (`wrangler email sending enable <domain>`, Workers Paid).
 */
export function createCloudflareSender(binding: SendEmail | undefined): MailSender {
  if (!binding) throw new Error('The "EMAIL" send_email binding is not configured.');

  return {
    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const { messageId } = await binding.send(toBuilder(message));
        return { messageIds: [messageId] };
      } catch (error) {
        const code = errorCode(error);
        const detail = error instanceof Error ? error.message.slice(0, MAX_PROVIDER_ERROR_CHARS) : "no details";
        throw new MailSendError(`Cloudflare Email Sending rejected the email: ${code ?? "no code"} (${detail}).`, {
          status: null,
          retryable: code === null || RETRYABLE_ERROR_CODES.has(code),
          cause: error,
        });
      }
    },
  };
}
