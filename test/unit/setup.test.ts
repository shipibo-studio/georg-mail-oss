// Where first-run setup may send the copy of new mail: never into a domain this install receives.
import { describe, expect, test } from "vitest";
import { canForwardCopy } from "../../src/worker/dashboard/setup-routes";

const RECEIVING = ["aurora.test", "example.com"];

describe("the forwarded copy's destination", () => {
  test.each(["me@gmail.com", "me@notaurora.test", "me@aurora.test.evil.test", "me@example.co"])(
    "%s is outside the install's domains",
    (owner) => {
      expect(canForwardCopy(owner, RECEIVING)).toBe(true);
    },
  );

  test.each(["hola@aurora.test", "Otro@Aurora.TEST", "x@mail.aurora.test", "x@deep.mail.example.com"])(
    "%s would loop back into this install",
    (owner) => {
      expect(canForwardCopy(owner, RECEIVING)).toBe(false);
    },
  );

  test("with no receiving domain, any address can take the copy", () => {
    expect(canForwardCopy("me@aurora.test", [])).toBe(true);
  });
});
