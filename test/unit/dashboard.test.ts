import { describe, expect, test } from "vitest";
import { accessIssuer, assertSameOriginWrite } from "../../src/worker/dashboard/dashboard-session";
import { threadableMessageId } from "../../src/worker/dashboard/mailbox-routes";

const BASE_URL = "https://mail.dasgeorg.cc";

describe("assertSameOriginWrite", () => {
  test.each(["GET", "HEAD", "OPTIONS"])("lets %s through without proof", (method) => {
    expect(() => assertSameOriginWrite(method, undefined, undefined, BASE_URL)).not.toThrow();
  });

  test("accepts a write from the dashboard's own origin with the marker", () => {
    expect(() => assertSameOriginWrite("POST", BASE_URL, "1", `${BASE_URL}/`)).not.toThrow();
  });

  test.each([
    ["no marker", BASE_URL, undefined],
    ["a wrong marker", BASE_URL, "true"],
    ["no origin", undefined, "1"],
    ["another origin", "https://evil.test", "1"],
    ["a lookalike origin", "https://mail.dasgeorg.cc.evil.test", "1"],
    ["a null origin", "null", "1"],
  ])("refuses a write with %s", (_case, origin, marker) => {
    expect(() => assertSameOriginWrite("DELETE", origin, marker, BASE_URL)).toThrow(/did not come from the dashboard/);
  });
});

describe("accessIssuer", () => {
  test.each([
    "https://team.cloudflareaccess.com",
    "https://team.cloudflareaccess.com/",
    " team.cloudflareaccess.com ",
    "HTTPS://team.cloudflareaccess.com",
  ])("reads %j as the token issuer", (value) => {
    expect(accessIssuer(value)).toBe("https://team.cloudflareaccess.com");
  });
});

describe("threadableMessageId", () => {
  test("keeps a well-formed Message-ID", () => {
    expect(threadableMessageId(" <abc.123@mail.acme.test> ")).toBe("<abc.123@mail.acme.test>");
  });

  test.each([
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["without brackets", "abc@acme.test"],
    ["with a line break", "<a@b>\r\nBcc: victim@example.com"],
    ["with spaces", "<a b@acme.test>"],
    ["with nested brackets", "<<a@b>>"],
    ["too long", `<${"a".repeat(251)}>`],
  ])("drops a Message-ID that is %s", (_case, value) => {
    expect(threadableMessageId(value)).toBeNull();
  });
});
