// The import dialog's time left: only once the pace is known, rounded up to whole minutes.
import { describe, expect, test } from "vitest";
import { minutesLeft } from "../src/components/ImportDialog";

describe("time left of an import", () => {
  test("waits for a few messages and a few seconds before promising anything", () => {
    expect(minutesLeft(4, 678, 60_000)).toBeNull();
    expect(minutesLeft(20, 678, 2_000)).toBeNull();
  });

  test("projects the pace so far over what is left, rounded up", () => {
    // 21 messages in 30 s: 657 left at ~1.43 s each is about 15.6 minutes.
    expect(minutesLeft(21, 678, 30_000)).toBe(16);
    expect(minutesLeft(670, 678, 600_000)).toBe(1);
  });

  test("says nothing once everything is handled", () => {
    expect(minutesLeft(678, 678, 600_000)).toBeNull();
  });
});
