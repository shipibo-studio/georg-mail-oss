// Which address a reply goes out from, and how long a rate-limited import waits.
import { describe, expect, test } from "vitest";
import { retryAfterMs } from "../src/api/client";
import type { FullMessage } from "../src/api/types";
import { replyDraft, replyFrom } from "../src/lib/reply";

const ALIASES = ["contact@example.com", "support@example.com"];

function message(overrides: Partial<FullMessage>): FullMessage {
  return {
    id: "msg_1",
    direction: "received",
    from: { address: "camila@estudio.cl", name: "Camila" },
    to: "hello@example.com",
    subject: "Propuesta",
    text: "Hola",
    recipients: null,
    ...overrides,
  } as FullMessage;
}

describe("the address a reply goes out from", () => {
  test("the alias the original reached, whatever its case", () => {
    expect(replyFrom(message({ to: "Contact@Example.com" }), ALIASES)).toBe("contact@example.com");
    expect(replyDraft(message({ to: "support@example.com" }), "On …", ALIASES).from).toBe("support@example.com");
  });

  test("the alias a sent message went out from", () => {
    const sent = message({
      direction: "sent",
      from: { address: "support@example.com", name: null } as FullMessage["from"],
      recipients: ["a@b.c"],
    });
    expect(replyFrom(sent, ALIASES)).toBe("support@example.com");
  });

  test("the mailbox's own address otherwise, including for an address that is no longer an alias", () => {
    expect(replyFrom(message({}), ALIASES)).toBeNull();
    expect(replyFrom(message({ to: "old@example.com" }), ALIASES)).toBeNull();
    expect(replyDraft(message({ to: "contact@example.com" }), "On …").from).toBeNull();
  });
});

describe("Retry-After", () => {
  test("seconds become milliseconds", () => {
    expect(retryAfterMs("60")).toBe(60_000);
    expect(retryAfterMs("0")).toBe(0);
  });

  test("absent or unreadable means no hint", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs("-5")).toBeNull();
  });
});
