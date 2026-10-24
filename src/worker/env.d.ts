// Secrets that are optional and never live in wrangler.jsonc, so `wrangler types` cannot see them.
// Set them with `wrangler secret put <NAME>` (see docs/self-hosting.md).
interface Env {
  /** Cloudflare Access team URL, for example https://your-team.cloudflareaccess.com. The dashboard is off without it. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the Access application protecting the dashboard. */
  ACCESS_AUD?: string;
  /** Resend API key ("re_…"), used when MAIL_PROVIDER is "resend". */
  RESEND_API_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    /** Mailtrap API token, used when MAIL_PROVIDER is "mailtrap". */
    MAILTRAP_API_KEY?: string;
  }
}
