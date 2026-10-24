const PRIVATE_IPV4 =
  /^(?:0|10|127)\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** Hosts that point inside a private network: following them can reach internal services. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return PRIVATE_IPV4.test(host);
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]|^fe[89ab]/.test(host);
  return false;
}
