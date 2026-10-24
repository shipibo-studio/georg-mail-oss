// Reads the sender authentication (DKIM, SPF, DMARC) that Cloudflare Email Routing records in the
// Authentication-Results header (RFC 8601). Anyone can write that header into a message, so only
// the topmost instance counts, and only when its authserv-id is Cloudflare's: Cloudflare prepends
// its own above anything the sender included.
import type { AuthenticationResult, SenderAuthentication } from "../db/schema";

export const CLOUDFLARE_AUTHSERV_ID = "mx.cloudflare.net";
/** Longer headers are not parsed: real ones are a few hundred characters. */
const MAX_HEADER_LENGTH = 4_000;
const RESULTS = new Set<AuthenticationResult>([
  "pass",
  "fail",
  "softfail",
  "neutral",
  "none",
  "temperror",
  "permerror",
]);
// Non-nested parenthesized comments, removed repeatedly; linear per pass.
const COMMENT_PATTERN = /\([^()]*\)/g;
const MAX_COMMENT_PASSES = 3;

// Quoted property values (`reason="…"`) can carry text the sender chose, including ";" and "dmarc=".
const QUOTED_STRING = /"(?:[^"\\]|\\.)*"/g;

function removeComments(value: string): string {
  let result = value;
  for (let pass = 0; pass < MAX_COMMENT_PASSES && result.includes("("); pass += 1) {
    result = result.replace(COMMENT_PATTERN, " ");
  }
  return result;
}

function toResult(value: string | undefined): AuthenticationResult {
  const normalized = value?.toLowerCase() as AuthenticationResult | undefined;
  return normalized && RESULTS.has(normalized) ? normalized : "none";
}

/** Splits "dkim=pass header.d=example.com header.s=s1" into the method, result and properties. */
function parseResultInfo(
  info: string,
): { method: string; result: AuthenticationResult; props: Map<string, string> } | null {
  const [methodAndResult, ...propertyTokens] = info.trim().split(/\s+/);
  const match = methodAndResult?.match(/^([a-z0-9-]+)=([a-z]+)$/i);
  if (!match) return null;
  const props = new Map<string, string>();
  for (const token of propertyTokens) {
    const separator = token.indexOf("=");
    if (separator > 0) props.set(token.slice(0, separator).toLowerCase(), token.slice(separator + 1).toLowerCase());
  }
  return { method: (match[1] ?? "").toLowerCase(), result: toResult(match[2]), props };
}

function domainOf(value: string | undefined): string | null {
  if (!value) return null;
  const domain = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value;
  return domain.replace(/[<>"]/g, "") || null;
}

/**
 * Parses the topmost Authentication-Results header. Returns null when it is missing, too long, or
 * was not written by the trusted authentication server.
 */
export function parseAuthenticationResults(
  header: string | null,
  trustedAuthservId = CLOUDFLARE_AUTHSERV_ID,
): SenderAuthentication | null {
  if (!header || header.length > MAX_HEADER_LENGTH) return null;
  const [authservPart, ...resultInfos] = removeComments(header.replace(/\s+/g, " ").replace(QUOTED_STRING, '""')).split(
    ";",
  );
  // The authserv-id may be followed by a version number: "mx.cloudflare.net 1".
  const authservId = authservPart?.trim().split(" ")[0]?.toLowerCase();
  if (authservId !== trustedAuthservId) return null;

  const authentication: SenderAuthentication = { dkim: [], spf: null, dmarc: null };
  for (const info of resultInfos) {
    const parsed = parseResultInfo(info);
    if (!parsed) continue;
    if (parsed.method === "dkim") {
      authentication.dkim.push({ result: parsed.result, domain: domainOf(parsed.props.get("header.d")) });
    } else if (parsed.method === "spf" && (authentication.spf === null || parsed.result === "pass")) {
      // Cloudflare reports SPF for both the HELO and MAIL FROM identities; a pass on either is kept.
      authentication.spf = {
        result: parsed.result,
        domain: domainOf(parsed.props.get("smtp.mailfrom") ?? parsed.props.get("smtp.helo")),
      };
    } else if (parsed.method === "dmarc") {
      // A real header has one DMARC result; a second one means the header was tampered with.
      if (authentication.dmarc !== null) return null;
      authentication.dmarc = { result: parsed.result, headerFrom: domainOf(parsed.props.get("header.from")) };
    }
  }
  return authentication;
}

/**
 * A sender is verified when DMARC passed for the domain in the From header: the domain owner
 * authorized the message through an aligned DKIM signature or SPF. Without that, the From header
 * is only a claim.
 */
export function isVerifiedSender(authentication: SenderAuthentication | null, fromAddress: string): boolean {
  const fromDomain = domainOf(fromAddress.toLowerCase());
  return (
    authentication?.dmarc?.result === "pass" && fromDomain !== null && authentication.dmarc.headerFrom === fromDomain
  );
}

export function senderDomain(fromAddress: string): string | null {
  return domainOf(fromAddress.toLowerCase());
}
