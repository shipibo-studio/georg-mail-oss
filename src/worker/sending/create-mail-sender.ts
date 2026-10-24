import { createCloudflareSender } from "./cloudflare-sender";
import type { MailSender } from "./mail-sender";
import { createMailtrapSender } from "./mailtrap-sender";
import { createResendSender } from "./resend-sender";

export const MAIL_PROVIDERS = ["cloudflare", "resend", "mailtrap"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export interface MailSenderEnv {
  /** Which provider sends: `cloudflare` (the EMAIL binding), `resend` or `mailtrap`. */
  MAIL_PROVIDER?: string;
  EMAIL?: SendEmail;
  RESEND_API_KEY?: string;
  MAILTRAP_API_KEY?: string;
}

function isMailProvider(value: string): value is MailProvider {
  return (MAIL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The configured outbound provider. Keys are Worker secrets in production (`wrangler secret put
 * RESEND_API_KEY`) and come from `.env` in local development; Cloudflare needs no key, only the binding.
 */
export function createMailSender(env: MailSenderEnv, fetchImpl?: typeof fetch): MailSender {
  const provider = env.MAIL_PROVIDER || "mailtrap";
  if (!isMailProvider(provider)) {
    throw new Error(`Unknown MAIL_PROVIDER "${provider}". Use one of: ${MAIL_PROVIDERS.join(", ")}.`);
  }
  switch (provider) {
    case "cloudflare":
      return createCloudflareSender(env.EMAIL);
    case "resend":
      return createResendSender({ apiKey: env.RESEND_API_KEY ?? "", fetch: fetchImpl });
    case "mailtrap":
      return createMailtrapSender({ apiToken: env.MAILTRAP_API_KEY ?? "", fetch: fetchImpl });
  }
}
