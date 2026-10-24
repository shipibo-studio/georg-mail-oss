// How a stored message is shown at each content access level: what the owner's mailbox reads in
// full, and what "safe" and "codes" readers never see (sender-chosen text, risky links).
import { describe, expect, test } from "vitest";
import type { Attachment, Message, SenderAuthentication, TrustedSender } from "../../src/worker/db/schema";
import { isPrivateHost } from "../../src/worker/http/private-hosts";
import { presentMessage, presentMessageSummary } from "../../src/worker/messages/message-access";

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const DMARC_PASS: SenderAuthentication = {
  dkim: [{ result: "pass", domain: "acme.test" }],
  spf: { result: "pass", domain: "mail.acme.test" },
  dmarc: { result: "pass", headerFrom: "acme.test" },
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    inboxId: "inb_1",
    fromAddress: "no-reply@acme.test",
    fromName: `Acme${ZERO_WIDTH_SPACE} Team`,
    envelopeFrom: "bounce@mail.acme.test",
    authentication: DMARC_PASS,
    internalSenderInboxId: null,
    risk: { level: "low", reasons: [] },
    toAddress: "hello@example.com",
    codes: ["123456"],
    extractedByAi: false,
    links: [],
    attachmentCount: 0,
    sizeBytes: 1_000,
    rawObjectKey: "personal/acc/inb/msg_1.eml",
    receivedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    readAt: null,
    subject: `Your code${ZERO_WIDTH_SPACE}`,
    safeText: "Your code is 123456.\n\nThanks",
    bodyTruncated: false,
    parseError: null,
    inReplyTo: null,
    messageIdHeader: "<id@acme.test>",
    htmlBody: "<p>Your code is <b>123456</b></p>",
    textBody: "Your code is 123456.",
    ...overrides,
  } as Message;
}

function attachment(contentType: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: `att_${contentType.replace(/\W/g, "")}`,
    messageId: "msg_1",
    filename: `file${ZERO_WIDTH_SPACE}.bin`,
    contentType,
    sizeBytes: 10,
    isInline: false,
    omitted: false,
    ...overrides,
  } as Attachment;
}

function trusted(kind: "domain" | "address", value: string): TrustedSender {
  return { id: "tsn_1", kind, value, verifiedAt: 1 } as TrustedSender;
}

const link = (url: string) => ({ url, isVerification: false });
const full = { access: "full" as const, include: new Set<"html" | "rawText">(), trustedSenders: [] };

describe("a message at each content access level", () => {
  test("full access shows sender-written text without invisible characters, and the HTML only when asked", () => {
    const shown = presentMessage(message(), [], { ...full, include: new Set(["html", "rawText"]) });
    expect(shown).toMatchObject({
      contentTrust: "untrusted",
      contentView: "full",
      subject: "Your code",
      from: { address: "no-reply@acme.test", name: "Acme Team", verified: true, domain: "acme.test" },
      html: "<p>Your code is <b>123456</b></p>",
      rawText: "Your code is 123456.",
      messageIdHeader: "<id@acme.test>",
      hasRaw: true,
      receivedAt: "2026-01-02T03:04:05.000Z",
      readAt: null,
    });
    expect(presentMessage(message(), [], full)).not.toHaveProperty("html");
    expect(presentMessage(message({ parseError: "bad charset" }), [], full)).toMatchObject({
      parseFailed: true,
      parseError: "bad charset",
    });
  });

  test("safe access keeps the readable text but neither HTML nor raw headers", () => {
    const shown = presentMessage(message(), [], { ...full, access: "safe", include: new Set(["html"]) });
    expect(shown).toMatchObject({ subject: "Your code", text: "Your code is 123456.\n\nThanks", parseFailed: false });
    expect(shown).not.toHaveProperty("html");
    expect(shown).not.toHaveProperty("messageIdHeader");
  });

  test("codes access gets no sender-chosen text: no subject, address, name or file names", () => {
    const shown = presentMessage(message(), [attachment("application/pdf")], { ...full, access: "codes" });
    expect(shown).not.toHaveProperty("subject");
    expect(shown).not.toHaveProperty("text");
    expect(shown.from).not.toHaveProperty("address");
    expect(shown.from).toMatchObject({
      domain: "acme.test",
      authentication: { dkim: ["pass"], spf: "pass", dmarc: "pass" },
    });
    expect(shown.attachments).toEqual([
      { id: "att_applicationpdf", kind: "pdf", sizeBytes: 10, inline: false, omitted: false },
    ]);
    expect(shown.codes).toEqual(["123456"]);
  });

  test("an unverified sender shows no domain, and no authentication results when there were none", () => {
    const shown = presentMessage(message({ authentication: null }), [], { ...full, access: "codes" });
    expect(shown.from).toMatchObject({ verified: false, domain: null, authentication: null });
  });

  test("mail from another inbox of the same project is verified as internal", () => {
    const shown = presentMessage(message({ authentication: null, internalSenderInboxId: "inb_2" }), [], full);
    expect(shown.from).toMatchObject({ verified: true, internal: true, senderInboxId: "inb_2" });
  });
});

describe("links", () => {
  const links = [
    link("https://acme.test/verify?t=1"),
    link("https://login.acme.test/reset"),
    link("http://acme.test/insecure"),
    link("https://evil.test/phish"),
    link("https://10.0.0.5/admin"),
    link("not a url"),
  ];

  test("say whether each belongs to the verified sender, is HTTPS and points inside a private network", () => {
    const shown = presentMessage(message({ links }), [], full);
    expect(
      shown.links.map(({ domain, secure, privateTarget, fromVerifiedSender }) => ({
        domain,
        secure,
        privateTarget,
        fromVerifiedSender,
      })),
    ).toEqual([
      { domain: "acme.test", secure: true, privateTarget: false, fromVerifiedSender: true },
      { domain: "login.acme.test", secure: true, privateTarget: false, fromVerifiedSender: true },
      { domain: "acme.test", secure: false, privateTarget: false, fromVerifiedSender: true },
      { domain: "evil.test", secure: true, privateTarget: false, fromVerifiedSender: false },
      { domain: "10.0.0.5", secure: true, privateTarget: true, fromVerifiedSender: false },
      { domain: null, secure: false, privateTarget: false, fromVerifiedSender: false },
    ]);
  });

  test("codes access keeps only HTTPS links on the verified sender's own domain", () => {
    const shown = presentMessage(message({ links }), [], { ...full, access: "codes" });
    expect(shown.links.map((shownLink) => shownLink.url)).toEqual([
      "https://acme.test/verify?t=1",
      "https://login.acme.test/reset",
    ]);
  });

  test("no link is the verified sender's when the From header was not verified", () => {
    const shown = presentMessage(message({ links, authentication: null }), [], full);
    expect(shown.links.every((shownLink) => !shownLink.fromVerifiedSender)).toBe(true);
  });

  test("a trusted sender's own links are marked as such", () => {
    const shown = presentMessage(message({ links: [link("https://acme.test/x")] }), [], {
      ...full,
      trustedSenders: [trusted("domain", "acme.test")],
    });
    expect(shown.links[0]).toMatchObject({ fromVerifiedSender: true, fromTrustedSender: true });
    expect(shown.from).toMatchObject({ trusted: true, trustedBy: "domain" });
  });
});

describe("attachments", () => {
  test.each([
    ["application/pdf", "pdf"],
    ["image/png", "image"],
    ["text/csv", "text"],
    ["audio/mpeg", "media"],
    ["video/mp4", "media"],
    ["application/zip", "archive"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["application/octet-stream", "other"],
  ])("%s is a %s", (contentType, kind) => {
    const [shown] = presentMessage(message(), [attachment(contentType)], full).attachments;
    expect(shown).toMatchObject({ kind, filename: "file.bin", contentType });
  });
});

describe("message summaries", () => {
  test("preview the safe text on one line, or the subject when there is no text", () => {
    expect(presentMessageSummary(message(), "safe", [])).toMatchObject({
      subject: "Your code",
      preview: "Your code is 123456. Thanks",
    });
    expect(presentMessageSummary(message({ safeText: null }), "safe", [])).toMatchObject({ preview: "Your code" });
    expect(presentMessageSummary(message({ safeText: null, subject: null }), "safe", [])).toMatchObject({
      preview: null,
    });
  });

  test("codes access gets neither subject nor preview", () => {
    const summary = presentMessageSummary(message({ readAt: Date.UTC(2026, 0, 3) }), "codes", []);
    expect(summary).not.toHaveProperty("subject");
    expect(summary).not.toHaveProperty("preview");
    expect(summary.readAt).toBe("2026-01-03T00:00:00.000Z");
  });
});

describe("private hosts", () => {
  test.each([
    "localhost",
    "app.localhost",
    "db.internal",
    "printer.local",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
  ])("%s is private", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  test.each(["acme.test", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "LOCALHOST.example"])(
    "%s is public",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});
