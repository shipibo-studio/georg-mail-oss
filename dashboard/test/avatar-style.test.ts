// Sender avatars as faces or initials: the letters, the tint, and the stored choice.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { avatarHue, initials } from "../src/lib/format";

describe("initials", () => {
  test("first and last word of a name, in capitals", () => {
    expect(initials("Camila Rojas", "camila@estudio.cl")).toBe("CR");
    expect(initials("ana maría de la fuente", null)).toBe("AF");
    expect(initials("Georg", null)).toBe("G");
  });

  test("ignore quotes and symbols, and keep letters beyond ASCII", () => {
    expect(initials('"Ñandú Óptica"', null)).toBe("ÑÓ");
    expect(initials("— Equipo 42", null)).toBe("E4");
  });

  test("fall back to the address, then to a question mark", () => {
    expect(initials(null, "zoe@example.com")).toBe("Z");
    expect(initials("  ", "")).toBe("?");
  });
});

describe("avatar tint", () => {
  test("is stable per sender and within the colour wheel", () => {
    expect(avatarHue("camila@estudio.cl")).toBe(avatarHue("camila@estudio.cl"));
    expect(avatarHue("camila@estudio.cl")).not.toBe(avatarHue("ana@estudio.cl"));
    for (const seed of ["", "a", "ñandú@óptica.cl", "x".repeat(500)]) {
      const hue = avatarHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

describe("the avatar style", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  test("defaults to faces", async () => {
    const { getAvatarStyle } = await import("../src/lib/avatar-style");
    expect(getAvatarStyle()).toBe("faces");
  });

  test("is kept in this browser, and an unknown stored value falls back to faces", async () => {
    const first = await import("../src/lib/avatar-style");
    first.setAvatarStyle("initials");
    expect(first.getAvatarStyle()).toBe("initials");
    vi.resetModules();
    expect((await import("../src/lib/avatar-style")).getAvatarStyle()).toBe("initials");

    localStorage.setItem("georg-mail.avatar-style", "<script>");
    vi.resetModules();
    expect((await import("../src/lib/avatar-style")).getAvatarStyle()).toBe("faces");
  });

  test("still changes for this visit when storage is blocked", async () => {
    const { setAvatarStyle, getAvatarStyle } = await import("../src/lib/avatar-style");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setAvatarStyle("initials");
    expect(getAvatarStyle()).toBe("initials");
    setItem.mockRestore();
  });
});
