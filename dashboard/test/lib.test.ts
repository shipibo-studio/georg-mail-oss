import { describe, expect, test } from "vitest";
import type { FullMessage } from "../src/api/types";
import {
  expiryLevel,
  formatBytes,
  formatFullDate,
  formatListTime,
  formatRelative,
  formatRemaining,
  sampleTime,
} from "../src/lib/format";
import { isValidAddress, normalizeRecipient, splitRecipients, uniqueRecipients } from "../src/lib/recipients";
import { EMPTY_DRAFT, quoteText, replyDraft, replySubject } from "../src/lib/reply";
import { hasSelection, parseRoute, type Route, routePath } from "../src/lib/route";

describe("recipients", () => {
  test("splits pasted text with names, separators and duplicates", () => {
    expect(splitRecipients('Ana Pérez <Ana@X.com>, bob@y.com; carl@z.com  bob@y.com "Dee, D." <dee@w.com>')).toEqual([
      "ana@x.com",
      "bob@y.com",
      "carl@z.com",
      "dee@w.com",
    ]);
  });

  test("ignores empty input", () => {
    expect(splitRecipients(" , ; ")).toEqual([]);
  });

  test("normalizes an angle address", () => {
    expect(normalizeRecipient("  Name <MiXeD@Example.COM> ")).toBe("mixed@example.com");
  });

  test.each([
    ["ana@example.com", true],
    ["a.b+tag@sub.example.co", true],
    ["no-at-sign", false],
    ["two@@example.com", false],
    ["ana@localhost", false],
    ["<script>@x.com", false],
    [`${"a".repeat(65)}@example.com`, false],
  ])("validates %s as %s", (address, valid) => {
    expect(isValidAddress(address)).toBe(valid);
  });

  test("merges lists without duplicates", () => {
    expect(uniqueRecipients(["a@x.co"], ["a@x.co", "b@x.co"])).toEqual(["a@x.co", "b@x.co"]);
  });
});

describe("route", () => {
  test.each([
    ["/dashboard/", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/sent", { section: "mail", folder: "sent", messageId: null }],
    ["/dashboard/inbox/msg_abc123", { section: "mail", folder: "inbox", messageId: "msg_abc123" }],
    ["/dashboard/sent/msg_abc123/", { section: "mail", folder: "sent", messageId: "msg_abc123" }],
    ["/dashboard/mailbox/msg_abc123", { section: "mail", folder: "inbox", messageId: "msg_abc123" }],
    ["/dashboard/archive", { section: "mail", folder: "archive", messageId: null }],
    ["/dashboard/drafts", { section: "mail", folder: "drafts", messageId: null }],
    ["/dashboard/trash/msg_abc123", { section: "mail", folder: "trash", messageId: "msg_abc123" }],
    ["/dashboard/spam/msg_abc123", { section: "mail", folder: "spam", messageId: "msg_abc123" }],
    ["/dashboard/outbox/msg_abc123", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/search", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/inbox/not-an-id", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/inbox/msg_<script>", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/unknown/msg_abc123", { section: "mail", folder: "inbox", messageId: null }],
    ["/dashboard/projects", { section: "projects", projectId: null, inboxId: null, messageId: null }],
    ["/dashboard/projects/prj_a1", { section: "projects", projectId: "prj_a1", inboxId: null, messageId: null }],
    [
      "/dashboard/projects/prj_a1/inb_b2/msg_c3",
      { section: "projects", projectId: "prj_a1", inboxId: "inb_b2", messageId: "msg_c3" },
    ],
    ["/dashboard/projects/inb_b2/msg_c3", { section: "projects", projectId: null, inboxId: null, messageId: null }],
    ["/dashboard/projects/prj_a1/msg_c3", { section: "projects", projectId: "prj_a1", inboxId: null, messageId: null }],
    ["/dashboard/keys", { section: "keys", keyId: null }],
    ["/dashboard/keys/new", { section: "keys", keyId: "new" }],
    ["/dashboard/keys/key_x9", { section: "keys", keyId: "key_x9" }],
    ["/dashboard/keys/../../etc", { section: "keys", keyId: null }],
    ["/dashboard/activity", { section: "activity" }],
    ["/dashboard/mcp", { section: "mcp" }],
    ["/dashboard/ai", { section: "ai" }],
    ["/dashboard/notifications", { section: "notifications" }],
    ["/dashboard/notify", { section: "notify", hookId: null }],
    ["/dashboard/notify/new", { section: "notify", hookId: "new" }],
    ["/dashboard/notify/nhk_a1", { section: "notify", hookId: "nhk_a1" }],
    ["/dashboard/notify/whk_a1", { section: "notify", hookId: null }],
  ])("parses %s", (path, expected) => {
    expect(parseRoute(path)).toEqual(expected);
  });

  test("keeps search terms in the fragment, and drops empty or overlong ones", () => {
    expect(parseRoute("/dashboard/search", "#q=factura%20abril")).toEqual({
      section: "mail",
      folder: "inbox",
      messageId: null,
      query: "factura abril",
    });
    expect(parseRoute("/dashboard/search/msg_a1", "#q=x")).toMatchObject({ messageId: "msg_a1", query: "x" });
    expect(parseRoute("/dashboard/search", "#q=%20%20")).toEqual({ section: "mail", folder: "inbox", messageId: null });
    expect(parseRoute("/dashboard/inbox", "#q=x")).toEqual({ section: "mail", folder: "inbox", messageId: null });
    expect((parseRoute("/dashboard/search", `#q=${"y".repeat(300)}`) as { query: string }).query).toHaveLength(200);
    const route: Route = { section: "mail", folder: "inbox", messageId: "msg_b2", query: "año & <b>" };
    const path = routePath(route);
    expect(path.split("#")[0]).toBe("/dashboard/search/msg_b2");
    expect(parseRoute(path.split("#")[0] ?? "", `#${path.split("#")[1]}`)).toEqual(route);
  });

  test("builds paths that parse back to the same route", () => {
    const routes: Route[] = [
      { section: "mail", folder: "inbox", messageId: null },
      { section: "mail", folder: "sent", messageId: "msg_x1" },
      { section: "mail", folder: "archive", messageId: null },
      { section: "mail", folder: "trash", messageId: "msg_x2" },
      { section: "projects", projectId: null, inboxId: null, messageId: null },
      { section: "projects", projectId: "prj_1", inboxId: null, messageId: null },
      { section: "projects", projectId: "prj_1", inboxId: "inb_2", messageId: "msg_3" },
      { section: "keys", keyId: null },
      { section: "keys", keyId: "new" },
      { section: "keys", keyId: "key_4" },
      { section: "activity" },
      { section: "mcp" },
      { section: "ai" },
      { section: "notifications" },
      { section: "notify", hookId: null },
      { section: "notify", hookId: "nhk_2" },
    ];
    for (const route of routes) expect(parseRoute(routePath(route))).toEqual(route);
  });

  test("knows when the detail is the side showing on phones", () => {
    expect(hasSelection(parseRoute("/dashboard/inbox/msg_1"))).toBe(true);
    expect(hasSelection(parseRoute("/dashboard/inbox"))).toBe(false);
    expect(hasSelection(parseRoute("/dashboard/projects/prj_1"))).toBe(false);
    expect(hasSelection(parseRoute("/dashboard/projects/prj_1/inb_2"))).toBe(true);
    expect(hasSelection(parseRoute("/dashboard/keys/new"))).toBe(true);
    expect(hasSelection(parseRoute("/dashboard/activity"))).toBe(false);
  });
});

describe("format", () => {
  const now = new Date(2026, 9, 17, 15, 0);

  test("shows the time today, the weekday this week, the day this year and the date before", () => {
    expect(formatListTime(new Date(2026, 9, 17, 9, 5).toISOString(), "es-419", "24h", now)).toMatch(/09:05|9:05/);
    expect(formatListTime(new Date(2026, 9, 14, 9, 5).toISOString(), "en", "24h", now)).toBe("Wed");
    expect(formatListTime(new Date(2026, 1, 3).toISOString(), "en", "24h", now)).toBe("Feb 3");
    expect(formatListTime(new Date(2024, 1, 3).toISOString(), "en", "24h", now)).toBe("2/3/24");
  });

  test("formats a full date", () => {
    expect(formatFullDate(new Date(2026, 9, 17, 9, 5).toISOString(), "en")).toContain("Oct 17, 2026");
  });

  test("writes times in 24-hour by default, and in 12-hour with AM/PM when chosen", () => {
    const now = new Date(2026, 9, 17, 23, 0);
    const afternoon = new Date(2026, 9, 17, 14, 5).toISOString();
    const midnight = new Date(2026, 9, 17, 0, 5).toISOString();
    expect(formatListTime(afternoon, "en", "24h", now)).toBe("14:05");
    expect(formatListTime(midnight, "en", "24h", now)).toBe("00:05");
    expect(formatListTime(afternoon, "en", "12h", now)).toBe("2:05 PM");
    expect(formatListTime(afternoon, "es-419", "12h", now)).toMatch(/^2:05\s?p\.\s?m\.$/);
    expect(formatFullDate(afternoon, "en")).toContain("14:05");
    expect(formatFullDate(afternoon, "en", "12h")).toContain("2:05 PM");
    expect(formatFullDate(afternoon, "pt-BR", "24h")).toContain("14:05");
    expect(sampleTime("en", "24h")).toBe("14:30");
    expect(sampleTime("en", "12h")).toBe("2:30 PM");
  });

  test.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [512 * 1024, "512 KB"],
    [5 * 1024 * 1024, "5 MB"],
    [-10, "0 B"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes, "en")).toBe(expected);
  });
});

describe("time", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  test.each([
    [now - 30_000, "en", "30 seconds ago"],
    [now - 5 * 60_000, "en", "5 minutes ago"],
    [now + 2 * 3_600_000, "en", "in 2 hours"],
    [now - 24 * 3_600_000, "en", "yesterday"],
    [now - 3 * 60_000, "es-419", "hace 3 minutos"],
  ] as const)("describes %s relative to now", (time, locale, expected) => {
    expect(formatRelative(new Date(time).toISOString(), locale, now)).toBe(expected);
  });

  test.each([
    [42_000, "42s"],
    [47 * 60_000, "47m"],
    [3 * 3_600_000, "3h"],
    [3 * 3_600_000 + 5 * 60_000, "3h 5m"],
    [6 * 86_400_000 + 1, "6d"],
    [-5_000, "0s"],
  ])("compacts %d ms left as %s", (milliseconds, expected) => {
    expect(formatRemaining(milliseconds, "en")).toBe(expected);
  });

  test.each([
    [10 * 60_000, "ok"],
    [4 * 60_000, "warn"],
    [30_000, "danger"],
    [0, "expired"],
  ])("colors %d ms left as %s", (milliseconds, expected) => {
    expect(expiryLevel(milliseconds)).toBe(expected);
  });
});

describe("reply", () => {
  const message = {
    id: "msg_1",
    direction: "received",
    from: { address: "ana@x.com", name: "Ana" },
    subject: "Propuesta",
    text: "Línea 1\r\nLínea 2\n",
    recipients: null,
  } as unknown as FullMessage;

  test("adds Re: once", () => {
    expect(replySubject("Propuesta")).toBe("Re: Propuesta");
    expect(replySubject("RE: Propuesta")).toBe("RE: Propuesta");
    expect(replySubject("Res: Proposta")).toBe("Res: Proposta");
    expect(replySubject(null)).toBe("Re:");
  });

  test("quotes the original under a header", () => {
    expect(quoteText("a\nb", "Ana wrote:")).toBe("\n\nAna wrote:\n> a\n> b");
    expect(quoteText(Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n"), "h").split("\n> ")).toHaveLength(61);
  });

  test("replies to the sender, or to the same recipients for a sent message", () => {
    expect(replyDraft(message, "Ana wrote:")).toEqual({
      to: ["ana@x.com"],
      cc: [],
      subject: "Re: Propuesta",
      text: "\n\nAna wrote:\n> Línea 1\n> Línea 2",
      inReplyTo: "msg_1",
      // A reply never carries the original's files.
      files: [],
    });
    const sent = { ...message, direction: "sent", recipients: ["b@y.com", "c@z.com"] } as FullMessage;
    expect(replyDraft(sent, "h").to).toEqual(["b@y.com", "c@z.com"]);
    expect(EMPTY_DRAFT.inReplyTo).toBeNull();
  });
});
