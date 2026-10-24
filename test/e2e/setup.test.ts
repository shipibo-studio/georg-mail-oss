// First run of a self-hosted mail client: whoever Cloudflare Access lets in creates the account,
// the mailbox and their membership, once. Runs against the mail client's own entry point.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DASHBOARD_REQUEST_HEADER } from "../../src/worker/dashboard/dashboard-session";
import { createDatabase } from "../../src/worker/db/client";
import { accounts, dashboardMembers, inboxes } from "../../src/worker/db/schema";
import mailWorker from "../../src/worker/mail-index";
import { ACCESS_CERTS_URL, accessJwk, accessToken, DASHBOARD_ORIGIN } from "../access-session";
import { BASE_URL, json } from "../mail-helpers";

const db = createDatabase(env.DB);
const OWNER = "owner@example.test";
// Storage lasts for the whole file, so every test gets addresses no earlier test took.
let hello = "";
let team = "";

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    return realFetch(input, init);
  });
});

// A fresh install: nobody owns it yet.
beforeEach(async () => {
  await db.delete(dashboardMembers);
  const suffix = crypto.randomUUID().slice(0, 8);
  hello = `hello-${suffix}@example.test`;
  team = `team-${suffix}@example.test`;
});

interface SetupRequest {
  method?: "GET" | "POST";
  body?: unknown;
  member?: string | null;
  sameOrigin?: boolean;
  env?: Partial<Env>;
}

async function setup(request: SetupRequest = {}): Promise<Response> {
  const method = request.method ?? "GET";
  const headers = new Headers();
  const member = request.member === undefined ? OWNER : request.member;
  if (member) headers.set("Cf-Access-Jwt-Assertion", await accessToken(member));
  if (method !== "GET" && request.sameOrigin !== false) {
    headers.set("Origin", DASHBOARD_ORIGIN);
    headers.set(DASHBOARD_REQUEST_HEADER, "1");
  }
  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  const context = createExecutionContext();
  const response = await mailWorker.fetch(
    new Request(`${BASE_URL}/dashboard/api/setup`, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    }),
    { ...env, PERSONAL_MAILBOX_ADDRESSES: `${hello}, ${team.toUpperCase()}`, ...request.env },
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const create = (body: unknown, request: SetupRequest = {}) => setup({ ...request, method: "POST", body });

describe("first-run setup", () => {
  test("says who is signed in and which configured addresses can become the mailbox", async () => {
    const response = await setup();
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      needed: true,
      email: OWNER,
      addresses: [hello, team],
    });
  });

  test("creates the self-hosted account, the mailbox and the owner's membership", async () => {
    const response = await create({ address: ` ${hello.toUpperCase()} `, displayName: "  Hola  " });
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({ address: hello, owner: OWNER });

    const [member] = await db.select().from(dashboardMembers).where(eq(dashboardMembers.email, OWNER));
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, member?.accountId ?? ""));
    const [mailbox] = await db.select().from(inboxes).where(eq(inboxes.address, hello));
    expect(account).toMatchObject({ planId: "self-hosted", name: "Hola" });
    expect(mailbox).toMatchObject({
      accountId: account?.id,
      kind: "personal",
      displayName: "Hola",
      forwardTo: OWNER,
      forwardEnabled: true,
      projectId: null,
    });
    expect(await json(await setup())).toEqual({ needed: false });
  });

  test("the owner's mailbox opens right after, with the self-hosted plan's limits", async () => {
    await create({ address: team, forward: false });
    const context = createExecutionContext();
    const response = await mailWorker.fetch(
      new Request(`${BASE_URL}/dashboard/api/mailbox`, {
        headers: { "Cf-Access-Jwt-Assertion": await accessToken(OWNER) },
      }),
      env,
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      address: team,
      forwardEnabled: false,
      maxMessageBytes: 524288,
    });
  });

  test("works once: a second person, or a second try, finds it already set up", async () => {
    expect((await create({ address: hello })).status).toBe(201);
    const stranger = await create({ address: team }, { member: "stranger@example.test" });
    expect(stranger.status).toBe(409);
    expect((await create({ address: team })).status).toBe(409);
    expect(await db.select().from(dashboardMembers)).toHaveLength(1);
    expect(await db.select().from(inboxes).where(eq(inboxes.address, team))).toEqual([]);
  });

  test("two setups at the same time make exactly one owner", async () => {
    const results = await Promise.all([
      create({ address: hello }),
      create({ address: team }, { member: "other@example.test" }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(dashboardMembers)).toHaveLength(1);
    const personal = await db.select().from(inboxes).where(eq(inboxes.kind, "personal"));
    expect(personal.filter((inbox) => [hello, team].includes(inbox.address))).toHaveLength(1);
  });

  test("only a configured address that no inbox uses can become the mailbox", async () => {
    expect((await create({ address: "someone@else.test" })).status).toBe(400);
    expect((await create({ address: "not an address" })).status).toBe(400);
    expect((await create({ address: hello, displayName: "x".repeat(101) })).status).toBe(400);
    expect((await create({})).status).toBe(400);
    expect(await db.select().from(dashboardMembers)).toEqual([]);
  });

  test("with no address configured there is nothing to choose", async () => {
    const response = await setup({ env: { PERSONAL_MAILBOX_ADDRESSES: "" } });
    expect(await json(response)).toMatchObject({ needed: true, addresses: [] });
    expect((await create({ address: hello }, { env: { PERSONAL_MAILBOX_ADDRESSES: "" } })).status).toBe(400);
  });

  test("needs a Cloudflare Access identity, and writes need the dashboard marker and origin", async () => {
    expect((await setup({ member: null })).status).toBe(401);
    expect((await create({ address: hello }, { member: null })).status).toBe(401);
    expect((await create({ address: hello }, { sameOrigin: false })).status).toBe(403);
    expect(await db.select().from(dashboardMembers)).toEqual([]);
  });

  test("is unavailable until Access is configured", async () => {
    expect((await setup({ env: { ACCESS_AUD: undefined } })).status).toBe(503);
  });
});
