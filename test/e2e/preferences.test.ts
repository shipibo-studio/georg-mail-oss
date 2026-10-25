// Display preferences kept in D1 per person, so theme, language and avatars follow them everywhere.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createDatabase } from "../../src/worker/db/client";
import { dashboardMembers } from "../../src/worker/db/schema";
import { ACCESS_CERTS_URL, accessJwk } from "../access-session";
import { json } from "../mail-helpers";
import { dashboard, randomName, setupOwner } from "../mailbox-owner";

const db = createDatabase(env.DB);

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    return realFetch(input, init);
  });
});

describe("display preferences", () => {
  test("start empty, and each change merges into what is saved", async () => {
    const owner = await setupOwner();
    expect(await json(await dashboard(owner, ""))).toMatchObject({ preferences: null });

    const first = await dashboard(owner, "/preferences", { method: "PUT", body: { theme: "dark", locale: "es-419" } });
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ theme: "dark", locale: "es-419" });

    await dashboard(owner, "/preferences", {
      method: "PUT",
      body: { avatars: "initials", theme: "light", sounds: "off" },
    });
    expect(await json(await dashboard(owner, ""))).toMatchObject({
      preferences: { theme: "light", locale: "es-419", avatars: "initials", sounds: "off" },
    });
  });

  test("accept only known preferences and their values", async () => {
    const owner = await setupOwner();
    for (const body of [
      {},
      { theme: "neon" },
      { locale: "fr" },
      { accent: "constructor" },
      { font: "comic" },
      { sounds: "loud" },
    ]) {
      expect((await dashboard(owner, "/preferences", { method: "PUT", body })).status, JSON.stringify(body)).toBe(400);
    }
    expect(await json(await dashboard(owner, ""))).toMatchObject({ preferences: null });
  });

  test("belong to each person, even on the same account", async () => {
    const owner = await setupOwner();
    const partner = { ...owner, member: `partner-${randomName()}@example.test` };
    await db
      .insert(dashboardMembers)
      .values({ email: partner.member, accountId: owner.accountId, createdAt: Date.now() });
    await dashboard(owner, "/preferences", { method: "PUT", body: { clock: "12h" } });
    expect(await json(await dashboard(partner, ""))).toMatchObject({ preferences: null });

    const stranger = await setupOwner();
    expect(await json(await dashboard(stranger, ""))).toMatchObject({ preferences: null });
  });

  test("changing them needs the dashboard session, its marker and its origin", async () => {
    const owner = await setupOwner();
    expect(
      (await dashboard(owner, "/preferences", { method: "PUT", body: { theme: "dark" }, token: null })).status,
    ).toBe(401);
    expect(
      (await dashboard(owner, "/preferences", { method: "PUT", body: { theme: "dark" }, sameOrigin: false })).status,
    ).toBe(403);
    expect(await json(await dashboard(owner, ""))).toMatchObject({ preferences: null });
  });
});
