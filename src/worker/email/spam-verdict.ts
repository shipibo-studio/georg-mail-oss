// Decides whether personal mail lands in Spam. Only signals a sender cannot fake on its own count:
// the owner's own choices, a DMARC failure reported by Cloudflare, and risky content from a sender
// that did not authenticate. A verified newsletter that happens to look risky stays in the inbox,
// with its risk banner, because its domain vouched for it.
import type { MessageRisk, SenderAuthentication, SenderVerdict, SpamReason } from "../db/schema";

export interface SpamInput {
  /** The owner's rule for the From address, if any. */
  senderRule: SenderVerdict | null;
  authentication: SenderAuthentication | null;
  senderVerified: boolean;
  risk: MessageRisk;
}

/** Null keeps the message in the inbox. */
export function spamReasonFor(input: SpamInput): SpamReason | null {
  if (input.senderRule === "block") return "blocked_sender";
  // The From domain says this message is not theirs: an allow rule cannot vouch for a forgery.
  if (input.authentication?.dmarc?.result === "fail") return "failed_authentication";
  if (input.senderRule === "allow") return null;
  if (input.risk.level === "high" && !input.senderVerified) return "high_risk";
  return null;
}
