// Aliases of the personal mailbox: more addresses (contact@, support@) that land in the same inbox
// and can be sent from. Each must be listed in PERSONAL_MAILBOX_ADDRESSES by the operator.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PERSONAL_ALIASES_MAX } from "../../src/worker/config";
import { DASHBOARD_REQUEST_HEADER } from "../../src/worker/dashboard/dashboard-session";
import { createDatabase } from "../../src/worker/db/client";
import { messages } from "../../src/worker/db/schema";
import mailWorker from "../../src/worker/mail-index";
import { ACCESS_CERTS_URL, accessJwk, accessToken, DASHBOARD_ORIGIN } from "../access-session";
import { BASE_URL, buildEmail, inboundEmail, isHost, json } from "../mail-helpers";
import { type Owner, randomName, setupOwner } from "../mailbox-owner";

type Json = Record<string, unknown>;

const db = createDatabase(env.DB);
let sent: Json[] = [];

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    if (isHost(request.url, "send.api.mailtrap.io")) {
      sent.push((await request.json()) as Json);
      return Response.json({ success: true, message_ids: ["m1"] });
    }
    return realFetch(input, init);
  });
});

beforeEach(() => {
  sent = [];
});

/** An owner and the extra addresses the operator configured for this install. */
async function install(extra = 2) {
  const owner = await setupOwner({ forwardTo: null });
  const addresses = Array.from({ length: extra }, (_, index) => `alias${index}-${randomName()}@${env.MAIL_DOMAIN}`);
  const configured = [owner.address, ...addresses].join(",");
  return { owner, addresses, env: { ...env, PERSONAL_MAILBOX_ADDRESSES: configured } as Env };
}

interface Call {
  method?: string;
  body?: unknown;
  member?: string | null;
  sameOrigin?: boolean;
  headers?: Record<string, string>;
}

async function call(installEnv: Env, owner: Owner, path: string, request: Call = {}): Promise<Response> {
  const method = request.method ?? "GET";
  const headers = new Headers(request.headers);
  const member = request.member === undefined ? owner.member : request.member;
  if (member) headers.set("Cf-Access-Jwt-Assertion", await accessToken(member));
  if (method !== "GET" && request.sameOrigin !== false) {
    headers.set("Origin", DASHBOARD_ORIGIN);
    headers.set(DASHBOARD_REQUEST_HEADER, "1");
  }
  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  const context = createExecutionContext();
  const response = await mailWorker.fetch(
    new Request(`${BASE_URL}/dashboard/api/mailbox${path}`, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    }),
    installEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const addAlias = (installEnv: Env, owner: Owner, address: string, request: Call = {}) =>
  call(installEnv, owner, "/aliases", { method: "POST", body: { address }, ...request });

async function receive(installEnv: Env, to: string, subject: string) {
  const email = inboundEmail(buildEmail({ to, from: "friend@acme.test", subject }), { to, from: "friend@acme.test" });
  const context = createExecutionContext();
  await mailWorker.email(email as unknown as ForwardableEmailMessage, installEnv, context);
  await waitOnExecutionContext(context);
  return email;
}

describe("mailbox aliases", () => {
  test("the mailbox lists its aliases and the configured addresses it can still add", async () => {
    const { owner, addresses, env: installEnv } = await install();
    expect(await json(await call(installEnv, owner, ""))).toMatchObject({
      address: owner.address,
      aliases: [],
      claimableAliases: addresses,
    });
    expect((await addAlias(installEnv, owner, ` ${addresses[0]?.toUpperCase()} `)).status).toBe(201);
    expect(await json(await call(installEnv, owner, ""))).toMatchObject({
      aliases: [addresses[0]],
      claimableAliases: [addresses[1]],
    });
  });

  test("mail to an alias lands in the mailbox and keeps the address it was sent to", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    const alias = addresses[0] ?? "";
    await addAlias(installEnv, owner, alias);
    const email = await receive(installEnv, alias, "To the alias");
    expect(email.rejection).toBeNull();
    const [row] = await db.select().from(messages).where(eq(messages.inboxId, owner.inboxId));
    expect(row).toMatchObject({ subject: "To the alias", toAddress: alias });
  });

  test("the owner can send from an alias, and from nothing that is not theirs", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    const alias = addresses[0] ?? "";
    await addAlias(installEnv, owner, alias);
    const send = (from: string, key: string) =>
      call(installEnv, owner, "/messages", {
        method: "POST",
        body: { to: ["friend@example.com"], subject: "Hola", text: "Saludos", from },
        headers: { "Idempotency-Key": key },
      });

    expect((await send(alias.toUpperCase(), `alias-${randomName()}`)).status).toBe(201);
    expect(sent[0]).toMatchObject({ from: { email: alias } });
    const [copy] = await db
      .select()
      .from(messages)
      .where(eq(messages.inboxId, owner.inboxId))
      .orderBy(messages.receivedAt);
    expect(copy).toMatchObject({ direction: "sent", fromAddress: alias });

    const refused = await send("ceo@elsewhere.test", `alias-${randomName()}`);
    expect(refused.status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  test("removing an alias stops its mail but keeps what it received", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    const alias = addresses[0] ?? "";
    await addAlias(installEnv, owner, alias);
    await receive(installEnv, alias, "Before");
    expect((await call(installEnv, owner, `/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" })).status).toBe(
      204,
    );
    const after = await receive(installEnv, alias, "After");
    expect(after.rejection).toMatch(/^550/);
    const subjects = (await db.select().from(messages).where(eq(messages.inboxId, owner.inboxId))).map(
      (row) => row.subject,
    );
    expect(subjects).toEqual(["Before"]);
    expect((await call(installEnv, owner, `/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });

  test("only an unused address from the configuration can become an alias", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    expect((await addAlias(installEnv, owner, `nobody-${randomName()}@${env.MAIL_DOMAIN}`)).status).toBe(400);
    expect((await addAlias(installEnv, owner, owner.address)).status).toBe(400);
    expect((await addAlias(installEnv, owner, "not an address")).status).toBe(400);
    expect((await addAlias(installEnv, owner, addresses[0] ?? "")).status).toBe(201);
    expect((await addAlias(installEnv, owner, addresses[0] ?? "")).status).toBe(400);
    expect((await call(installEnv, owner, "/aliases", { method: "POST", body: {} })).status).toBe(400);
  });

  test(`a mailbox has at most ${PERSONAL_ALIASES_MAX} aliases`, async () => {
    const { owner, addresses, env: installEnv } = await install(PERSONAL_ALIASES_MAX + 1);
    for (const address of addresses.slice(0, PERSONAL_ALIASES_MAX)) {
      expect((await addAlias(installEnv, owner, address)).status).toBe(201);
    }
    expect((await addAlias(installEnv, owner, addresses[PERSONAL_ALIASES_MAX] ?? "")).status).toBe(403);
  });

  test("another account can neither take nor remove the owner's alias", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    const alias = addresses[0] ?? "";
    await addAlias(installEnv, owner, alias);
    const stranger = await setupOwner();
    expect((await addAlias(installEnv, stranger, alias)).status).toBe(400);
    expect(
      (await call(installEnv, stranger, `/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(await json(await call(installEnv, owner, ""))).toMatchObject({ aliases: [alias] });
  });

  test("changing aliases needs the dashboard session, its marker and its origin", async () => {
    const { owner, addresses, env: installEnv } = await install(1);
    const alias = addresses[0] ?? "";
    expect((await addAlias(installEnv, owner, alias, { member: null })).status).toBe(401);
    expect((await addAlias(installEnv, owner, alias, { sameOrigin: false })).status).toBe(403);
    expect(await json(await call(installEnv, owner, ""))).toMatchObject({ aliases: [] });
  });
});
