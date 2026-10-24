import { describe, expect, test } from "vitest";
import { ApiError } from "../../src/worker/errors";
import { assertContentAccess, grantsAtLeast, includeQuerySchema } from "../../src/worker/messages/content-access";

describe("content access", () => {
  test("orders levels from codes to full", () => {
    expect(grantsAtLeast("full", "codes")).toBe(true);
    expect(grantsAtLeast("safe", "safe")).toBe(true);
    expect(grantsAtLeast("codes", "safe")).toBe(false);
    expect(grantsAtLeast("safe", "full")).toBe(false);
  });

  test("explains a missing level", () => {
    expect(() => assertContentAccess("codes", "full", "raw messages")).toThrow(ApiError);
    expect(() => assertContentAccess("full", "full", "raw messages")).not.toThrow();
  });

  test("parses include lists and rejects unknown entries", () => {
    expect(includeQuerySchema.parse(undefined)).toEqual(new Set());
    expect(includeQuerySchema.parse("html, rawText")).toEqual(new Set(["html", "rawText"]));
    expect(includeQuerySchema.safeParse("html,attachments").success).toBe(false);
  });
});
