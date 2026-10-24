// Where first-run setup may send the copy of new mail: never into a domain this install receives.
import { describe, expect, test } from "vitest";
import { canForwardCopy } from "../../src/worker/dashboard/setup-routes";

const RECEIVING = ["andalaosa.cl", "example.com"];

describe("the forwarded copy's destination", () => {
  test.each(["me@gmail.com", "me@notandalaosa.cl", "me@andalaosa.cl.evil.test", "me@example.co"])(
    "%s is outside the install's domains",
    (owner) => {
      expect(canForwardCopy(owner, RECEIVING)).toBe(true);
    },
  );

  test.each(["hola@andalaosa.cl", "Otro@AndaLaosa.CL", "x@mail.andalaosa.cl", "x@deep.mail.example.com"])(
    "%s would loop back into this install",
    (owner) => {
      expect(canForwardCopy(owner, RECEIVING)).toBe(false);
    },
  );

  test("with no receiving domain, any address can take the copy", () => {
    expect(canForwardCopy("me@andalaosa.cl", [])).toBe(true);
  });
});
