import { MAIL_SEND_TIMEOUT_MS, MAILTRAP_SEND_URL, MAX_PROVIDER_ERROR_CHARS } from "../config";
import { MailSendError, type MailSender, type OutboundMessage, type SendResult } from "./mail-sender";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

export interface MailtrapSenderOptions {
  apiToken: string;
  /** Injectable for tests; defaults to the runtime's fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface MailtrapSendResponse {
  success?: boolean;
  message_ids?: unknown;
  errors?: unknown;
}

function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR_MIN;
}

function describeProviderErrors(errors: unknown): string {
  const list = Array.isArray(errors) ? errors.filter((error) => typeof error === "string") : [];
  return list.join("; ").slice(0, MAX_PROVIDER_ERROR_CHARS) || "no details";
}

async function readJson(response: Response): Promise<MailtrapSendResponse> {
  try {
    return (await response.json()) as MailtrapSendResponse;
  } catch {
    return {};
  }
}

/** Mailtrap takes the neutral message as is, except for attachments' field names. */
function toMailtrapBody(message: OutboundMessage) {
  if (!message.attachments?.length) return message;
  return {
    ...message,
    attachments: message.attachments.map((file) => ({
      content: file.content,
      filename: file.filename,
      type: file.contentType,
      disposition: "attachment",
    })),
  };
}

/** Sends through the Mailtrap Email API. The token is only ever placed in the Authorization header. */
export function createMailtrapSender(options: MailtrapSenderOptions): MailSender {
  if (!options.apiToken) throw new Error("MAILTRAP_API_KEY is not configured.");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS;

  return {
    async send(message: OutboundMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await fetchImpl(MAILTRAP_SEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(toMailtrapBody(message)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new MailSendError("Mailtrap could not be reached.", { status: null, retryable: true, cause: error });
      }

      const body = await readJson(response);
      if (!response.ok || body.success !== true) {
        throw new MailSendError(`Mailtrap rejected the email: ${describeProviderErrors(body.errors)}.`, {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }
      const messageIds = Array.isArray(body.message_ids)
        ? body.message_ids.filter((id): id is string => typeof id === "string")
        : [];
      return { messageIds };
    },
  };
}
