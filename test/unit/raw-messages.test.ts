import { describe, expect, test } from "vitest";
import { accountPrefix, inboxPrefix, RAW_ROOT_PREFIX, rawMessageKey } from "../../src/worker/storage/raw-messages";

describe("raw message keys", () => {
  test("nest messages under their inbox and account, so both can be deleted by prefix", () => {
    const key = rawMessageKey("acc_1", "inb_2", "msg_3");
    expect(key).toBe("raw/acc_1/inb_2/msg_3.eml");
    expect(key.startsWith(inboxPrefix("acc_1", "inb_2"))).toBe(true);
    expect(key.startsWith(accountPrefix("acc_1"))).toBe(true);
    expect(accountPrefix("acc_1").startsWith(RAW_ROOT_PREFIX)).toBe(true);
  });

  test("prefixes end with a slash, so one account never matches another that shares its start", () => {
    expect(accountPrefix("acc_1")).toBe("raw/acc_1/");
    expect(rawMessageKey("acc_10", "inb_2", "msg_3").startsWith(accountPrefix("acc_1"))).toBe(false);
    expect(inboxPrefix("acc_1", "inb_2")).toBe("raw/acc_1/inb_2/");
  });
});
