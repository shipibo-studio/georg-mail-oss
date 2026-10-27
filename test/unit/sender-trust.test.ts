// Who sent a message, as the mail client and the hosted product both judge it: addresses and
// domains as people type them, and trust that only a DMARC-verified From header can earn.
import { describe, expect, test } from "vitest";
import type { Message, TrustedSender } from "../../src/worker/db/schema";
import { normalizeAddress, normalizeDomain } from "../../src/worker/email/email-address";
import { ApiError } from "../../src/worker/errors";
import { senderTrust } from "../../src/worker/messages/sender-trust";

function sender(overrides: Partial<TrustedSender>): TrustedSender {
  return {
    id: "tsn_aaaaaaaaaaaaaaaaaaaa",
    accountId: "acc_1",
    projectId: "prj_1",
    kind: "domain",
    value: "acme.test",
    verifiedAt: 1,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    verificationSentAt: null,
    dnsToken: null,
    dnsVerifiedAt: null,
    dnsCheckedAt: null,
    locale: "en",
    createdAt: 1,
    ...overrides,
  };
}

function message(fromAddress: string, dmarc: "pass" | "fail", headerFrom = fromAddress.split("@")[1] ?? ""): Message {
  // Only the sender fields matter to trust; the rest of the row is irrelevant here.
  return {
    fromAddress,
    authentication: { dkim: [], spf: null, dmarc: { result: dmarc, headerFrom } },
  } as unknown as Message;
}

describe("addresses and domains", () => {
  test.each([
    ["Acme.Test", "acme.test"],
    ["mail.acme.test.", "mail.acme.test"],
  ])("normalizes the domain %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  test.each(["acme", "https://acme.test", "acme.test/path", "-acme.test", "a..test", "acme.123"])(
    "rejects the domain %j",
    (input) => {
      expect(() => normalizeDomain(input)).toThrow(ApiError);
    },
  );

  test("normalizes addresses and rejects malformed ones", () => {
    expect(normalizeAddress(" Dev@Acme.Test ")).toBe("dev@acme.test");
    for (const input of ["dev", "@acme.test", "dev@", "a b@acme.test", "dev@acme", "<x>@acme.test"]) {
      expect(() => normalizeAddress(input)).toThrow(ApiError);
    }
  });
});

describe("sender trust", () => {
  const domain = sender({ kind: "domain", value: "acme.test" });
  const address = sender({ kind: "address", value: "ceo@partner.test" });

  test("trusts a DMARC-verified sender by address or by domain and subdomain", () => {
    expect(senderTrust(message("ceo@partner.test", "pass"), [domain, address])).toEqual({
      trusted: true,
      trustedBy: "address",
    });
    expect(senderTrust(message("no-reply@acme.test", "pass"), [domain])).toEqual({
      trusted: true,
      trustedBy: "domain",
    });
    expect(senderTrust(message("x@mail.acme.test", "pass"), [domain])).toEqual({ trusted: true, trustedBy: "domain" });
  });

  test("never trusts a From header that DMARC did not verify", () => {
    expect(senderTrust(message("ceo@partner.test", "fail"), [address])).toEqual({ trusted: false, trustedBy: null });
    expect(senderTrust(message("x@acme.test", "pass", "evil.test"), [domain])).toEqual({
      trusted: false,
      trustedBy: null,
    });
  });

  test("does not match look-alike domains or other addresses", () => {
    expect(senderTrust(message("x@notacme.test", "pass"), [domain]).trusted).toBe(false);
    expect(senderTrust(message("intern@partner.test", "pass"), [address]).trusted).toBe(false);
    expect(senderTrust(message("x@acme.test", "pass"), []).trusted).toBe(false);
  });
});
