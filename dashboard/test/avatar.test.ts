import { describe, expect, test } from "vitest";
import { avatarSeed, senderAvatarUri } from "../src/lib/avatar";

const decode = (uri: string) => decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));

describe("sender avatars", () => {
  test("seeds by address, case-insensitive, falling back to the name", () => {
    expect(avatarSeed("Camila", " Camila@Estudio.cl ")).toBe("camila@estudio.cl");
    expect(avatarSeed("Acme", null)).toBe("acme");
    expect(avatarSeed(null, null)).toBe("");
  });

  test("gives each sender the same face every time, and different senders different faces", () => {
    const camila = senderAvatarUri("camila@estudio.cl");
    expect(senderAvatarUri("camila@estudio.cl")).toBe(camila);
    expect(senderAvatarUri("billing@acme.dev")).not.toBe(camila);
  });

  test("is an SVG data URI in the Georg palette", () => {
    const uri = senderAvatarUri("camila@estudio.cl");
    expect(uri).toMatch(/^data:image\/svg\+xml/);
    const svg = decode(uri);
    expect(svg).toMatch(/^<svg/);
    expect(svg.toLowerCase()).toContain("#0f0f12");
  });

  test("a hostile seed never reaches the SVG markup", () => {
    const hostile = '"><script>alert(1)</script><img src=x onerror=alert(1)>@evil.test';
    const svg = decode(senderAvatarUri(avatarSeed(null, hostile)));
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onerror");
    expect(svg).not.toContain("evil.test");
  });

  test("stays consistent past the cache limit", () => {
    for (let index = 0; index < 600; index++) senderAvatarUri(`sender-${index}@x.test`);
    expect(senderAvatarUri("sender-599@x.test")).toBe(senderAvatarUri("sender-599@x.test"));
  });
});
