import { describe, expect, test } from "vitest";
import { importedAt } from "../../src/worker/dashboard/mail-import";

const NOW = Date.UTC(2026, 9, 22, 12, 0);

describe("imported dates", () => {
  test("keep the Date header of the message", () => {
    expect(importedAt("Tue, 3 Mar 2020 10:15:00 -0300", NOW)).toBe(Date.UTC(2020, 2, 3, 13, 15));
  });

  test("fall back to the import time when missing, unreadable or impossible", () => {
    expect(importedAt(null, NOW)).toBe(NOW);
    expect(importedAt("not a date", NOW)).toBe(NOW);
    expect(importedAt("Mon, 1 Jan 1970 00:00:00 +0000", NOW)).toBe(NOW);
    expect(importedAt("Fri, 1 Jan 2100 00:00:00 +0000", NOW)).toBe(NOW);
  });

  test("a clock slightly ahead is brought back to now", () => {
    expect(importedAt(new Date(NOW + 60 * 60 * 1000).toUTCString(), NOW)).toBe(NOW);
  });
});
