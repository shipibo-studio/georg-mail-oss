// Email addresses and domains as typed by people: trimmed, lowercased and checked, so a recipient,
// a trusted sender or a destination is always one plain address.
import { ApiError } from "../errors";

// Lowercase DNS names with at least one dot and an alphabetic top-level label.
const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_PART_PATTERN = /^[a-z0-9._%+-]{1,64}$/;

export function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new ApiError("validation_failed", `"${value}" is not a valid domain.`, {
      hint: 'Use a domain name such as "loremipsum.com", without a scheme or path.',
    });
  }
  return domain;
}

export function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  const valid = at > 0 && LOCAL_PART_PATTERN.test(address.slice(0, at)) && DOMAIN_PATTERN.test(address.slice(at + 1));
  if (!valid) {
    throw new ApiError("validation_failed", `"${value}" is not a valid email address.`, {
      hint: 'Use a single address such as "dev@loremipsum.com".',
    });
  }
  return address;
}
