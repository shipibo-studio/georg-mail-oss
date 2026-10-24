import { describe, expect, test } from "vitest";
import {
  isVerifiedSender,
  parseAuthenticationResults,
  senderDomain,
} from "../../src/worker/email/sender-authentication";

// Recorded from a real email delivered through Cloudflare Email Routing on 2026-10-17.
const CLOUDFLARE_HEADER = `mx.cloudflare.net;
	dkim=pass header.d=smtp.mailtrap.live header.s=rwmt2 header.b=lPf7rML8;
	dkim=pass header.d=dasgeorg.cc header.s=rwmt2 header.b=ZVXIhiBQ;
	dmarc=pass header.from=dasgeorg.cc policy.dmarc=none;
	spf=none (mx.cloudflare.net: no SPF records found for postmaster@smtp-83-25.mailtrap.live) smtp.helo=smtp-83-25.mailtrap.live;
	spf=pass (mx.cloudflare.net: domain of ndr-1@mt74.dasgeorg.cc designates 45.158.83.25 as permitted sender) smtp.mailfrom=ndr-1@mt74.dasgeorg.cc;`;

describe("Authentication-Results", () => {
  test("parses Cloudflare's DKIM, SPF and DMARC results", () => {
    expect(parseAuthenticationResults(CLOUDFLARE_HEADER)).toEqual({
      dkim: [
        { result: "pass", domain: "smtp.mailtrap.live" },
        { result: "pass", domain: "dasgeorg.cc" },
      ],
      spf: { result: "pass", domain: "mt74.dasgeorg.cc" },
      dmarc: { result: "pass", headerFrom: "dasgeorg.cc" },
    });
  });

  test("accepts a version after the authserv-id and unknown results as none", () => {
    expect(
      parseAuthenticationResults("mx.cloudflare.net 1; dkim=weird header.d=a.test; dmarc=fail header.from=a.test"),
    ).toEqual({
      dkim: [{ result: "none", domain: "a.test" }],
      spf: null,
      dmarc: { result: "fail", headerFrom: "a.test" },
    });
  });

  test.each([
    ["another authentication server", "evil.test; dmarc=pass header.from=bank.test"],
    ["a look-alike authserv-id", "mx.cloudflare.net.evil.test; dmarc=pass header.from=bank.test"],
    ["an oversized header", `mx.cloudflare.net; ${"dkim=pass header.d=a.test; ".repeat(200)}`],
    ["no header", null],
  ])("ignores %s", (_case, header) => {
    expect(parseAuthenticationResults(header)).toBeNull();
  });

  test("skips malformed result entries", () => {
    expect(parseAuthenticationResults("mx.cloudflare.net; garbage; =pass; dkim pass")).toEqual({
      dkim: [],
      spf: null,
      dmarc: null,
    });
  });

  test("rejects a header with two DMARC results as tampered", () => {
    const parsed = parseAuthenticationResults(
      "mx.cloudflare.net; dmarc=fail header.from=bank.test; dmarc=pass header.from=bank.test",
    );
    expect(parsed).toBeNull();
  });

  test("ignores results smuggled inside quoted values", () => {
    const parsed = parseAuthenticationResults(
      'mx.cloudflare.net; dkim=fail reason="x; dmarc=pass header.from=bank.test" header.d=evil.test; dmarc=fail header.from=bank.test',
    );
    expect(parsed?.dmarc).toEqual({ result: "fail", headerFrom: "bank.test" });
    expect(parsed?.dkim).toEqual([{ result: "fail", domain: "evil.test" }]);
  });
});

describe("verified senders", () => {
  const passFor = (domain: string) => parseAuthenticationResults(`mx.cloudflare.net; dmarc=pass header.from=${domain}`);

  test("requires a DMARC pass for the From domain", () => {
    expect(isVerifiedSender(passFor("bank.test"), "No-Reply@Bank.test")).toBe(true);
    expect(isVerifiedSender(passFor("evil.test"), "no-reply@bank.test")).toBe(false);
    expect(
      isVerifiedSender(
        parseAuthenticationResults("mx.cloudflare.net; dmarc=fail header.from=bank.test"),
        "a@bank.test",
      ),
    ).toBe(false);
    expect(
      isVerifiedSender(parseAuthenticationResults("mx.cloudflare.net; dkim=pass header.d=bank.test"), "a@bank.test"),
    ).toBe(false);
    expect(isVerifiedSender(null, "a@bank.test")).toBe(false);
  });

  test("extracts the sender domain", () => {
    expect(senderDomain("No-Reply@Bank.Test")).toBe("bank.test");
    expect(senderDomain("")).toBeNull();
  });
});
