// Whether a message comes from one of the trusted senders it is checked against. Pure: the caller
// passes the verified senders it knows about (none in the personal mailbox).
import type { Message, TrustedSender } from "../db/schema";
import { isVerifiedSender, senderDomain } from "../email/sender-authentication";

export interface SenderTrust {
  trusted: boolean;
  trustedBy: "domain" | "address" | null;
}

const UNTRUSTED: SenderTrust = { trusted: false, trustedBy: null };

/**
 * Whether a message comes from one of the project's trusted senders. The From header is only
 * believed when DMARC passed for its domain, so a forged From never inherits trust.
 */
export function senderTrust(
  message: Pick<Message, "fromAddress" | "authentication">,
  verifiedSenders: TrustedSender[],
): SenderTrust {
  if (verifiedSenders.length === 0 || !isVerifiedSender(message.authentication, message.fromAddress)) return UNTRUSTED;
  const address = message.fromAddress.toLowerCase();
  if (verifiedSenders.some((sender) => sender.kind === "address" && sender.value === address)) {
    return { trusted: true, trustedBy: "address" };
  }
  const domain = senderDomain(address);
  const byDomain = verifiedSenders.some(
    (sender) =>
      sender.kind === "domain" && domain !== null && (domain === sender.value || domain.endsWith(`.${sender.value}`)),
  );
  return byDomain ? { trusted: true, trustedBy: "domain" } : UNTRUSTED;
}
