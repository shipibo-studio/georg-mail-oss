import { describe, expect, test } from "vitest";
import type { MessageRisk, SenderAuthentication } from "../../src/worker/db/schema";
import { type SpamInput, spamReasonFor } from "../../src/worker/email/spam-verdict";

const LOW: MessageRisk = { level: "low", reasons: [] };
const HIGH: MessageRisk = { level: "high", reasons: ["injection_phrases"] };
const dmarc = (result: "pass" | "fail" | "none"): SenderAuthentication => ({
  dkim: [],
  spf: null,
  dmarc: { result, headerFrom: "acme.test" },
});
const input = (overrides: Partial<SpamInput>): SpamInput => ({
  senderRule: null,
  authentication: null,
  senderVerified: false,
  risk: LOW,
  ...overrides,
});

describe("spam verdict", () => {
  test("ordinary mail stays in the inbox, verified or not", () => {
    expect(spamReasonFor(input({}))).toBeNull();
    expect(spamReasonFor(input({ authentication: dmarc("pass"), senderVerified: true }))).toBeNull();
    expect(spamReasonFor(input({ authentication: dmarc("none") }))).toBeNull();
  });

  test("a blocked sender goes to Spam even when verified", () => {
    expect(spamReasonFor(input({ senderRule: "block", authentication: dmarc("pass"), senderVerified: true }))).toBe(
      "blocked_sender",
    );
  });

  test("a DMARC failure goes to Spam, and an allow rule cannot vouch for it", () => {
    expect(spamReasonFor(input({ authentication: dmarc("fail") }))).toBe("failed_authentication");
    expect(spamReasonFor(input({ senderRule: "allow", authentication: dmarc("fail") }))).toBe("failed_authentication");
  });

  test("high-risk content goes to Spam only from an unverified sender", () => {
    expect(spamReasonFor(input({ risk: HIGH }))).toBe("high_risk");
    expect(spamReasonFor(input({ risk: HIGH, authentication: dmarc("pass"), senderVerified: true }))).toBeNull();
    expect(spamReasonFor(input({ risk: { level: "medium", reasons: ["hidden_content"] } }))).toBeNull();
  });

  test("an allowed sender skips the content check", () => {
    expect(spamReasonFor(input({ senderRule: "allow", risk: HIGH }))).toBeNull();
  });
});
