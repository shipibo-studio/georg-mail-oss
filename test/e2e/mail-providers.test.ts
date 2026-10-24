// The owner's personal send, end to end through the real Worker, with each outbound provider. Only
// the Worker's configuration changes between them (MAIL_PROVIDER and its credentials or binding).
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PERSONAL_MAILBOX_EXPIRES_AT, RESEND_SEND_URL } from "../../src/worker/config";
import { DASHBOARD_REQUEST_HEADER } from "../../src/worker/dashboard/dashboard-session";
import { createDatabase } from "../../src/worker/db/client";
import { dashboardMembers, inboxes, messages } from "../../src/worker/db/schema";
import { createId } from "../../src/worker/ids";
import { ACCESS_CERTS_URL, accessJwk, accessToken, DASHBOARD_ORIGIN } from "../access-session";
import { BASE_URL, createOwnerAccount } from "../mail-helpers";
import { mailWorker } from "../mail-worker";

type Json = Record<string, unknown>;

const db = createDatabase(env.DB);
let resendRequests: { authorization: string | null; body: Json }[] = [];

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    if (request.url === RESEND_SEND_URL) {
      resendRequests.push({
        authorization: request.headers.get("Authorization"),
        body: (await request.json()) as Json,
      });
      return Response.json({ id: "re-1" });
    }
    return realFetch(input, init);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => vi.restoreAllMocks());

async function setupOwner() {
  const accountId = await createOwnerAccount();
  const now = Date.now();
  const suffix = createId("acc").slice(4, 14);
  const member = `owner-${suffix}@example.test`;
  const inboxId = createId("inb");
  const address = `me-${suffix}@${env.MAIL_DOMAIN}`;
  await db.insert(inboxes).values({
    id: inboxId,
    accountId,
    kind: "personal",
    forwardTo: null,
    projectId: null,
    label: null,
    address,
    displayName: "Owner",
    messageCount: 0,
    createdAt: now,
    expiresAt: PERSONAL_MAILBOX_EXPIRES_AT,
  });
  await db.insert(dashboardMembers).values({ email: member, accountId, createdAt: now });
  return { member, inboxId, address };
}

/** POST /dashboard/api/mailbox/messages exactly as the dashboard does, with a Worker configuration. */
async function sendWith(overrides: Partial<Env>, owner: { member: string }, idempotencyKey: string) {
  const request = new Request(`${BASE_URL}/dashboard/api/mailbox/messages`, {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": await accessToken(owner.member),
      Origin: DASHBOARD_ORIGIN,
      [DASHBOARD_REQUEST_HEADER]: "1",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ to: ["Friend@Example.com"], subject: "Hola", text: "Saludos" }),
  });
  const context = createExecutionContext();
  const response = await mailWorker.fetch(request, { ...env, ...overrides }, context);
  await waitOnExecutionContext(context);
  return response;
}

const sentCopies = (inboxId: string) => db.select().from(messages).where(eq(messages.inboxId, inboxId));

describe("outbound providers", () => {
  test("Resend: sends with the key in the header and keeps a copy in Sent", async () => {
    resendRequests = [];
    const owner = await setupOwner();

    const response = await sendWith({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key" }, owner, "resend-send-1");

    expect(response.status).toBe(201);
    expect(resendRequests).toHaveLength(1);
    expect(resendRequests[0]?.authorization).toBe("Bearer re_test_key");
    expect(resendRequests[0]?.body).toMatchObject({
      from: `"Owner" <${owner.address}>`,
      to: ["friend@example.com"],
      subject: "Hola",
      text: "Saludos",
      tags: [{ name: "category", value: "Personal" }],
    });
    expect(JSON.stringify(resendRequests[0]?.body)).not.toContain("re_test_key");
    expect(await sentCopies(owner.inboxId)).toHaveLength(1);
  });

  test("Cloudflare: sends through the EMAIL binding, with no key and no HTTP call", async () => {
    resendRequests = [];
    const owner = await setupOwner();
    const send = vi.fn(async () => ({ messageId: "cf-1" }));

    const response = await sendWith(
      { MAIL_PROVIDER: "cloudflare", EMAIL: { send } as unknown as SendEmail },
      owner,
      "cloudflare-send-1",
    );

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({
      from: { email: owner.address, name: "Owner" },
      to: ["friend@example.com"],
      subject: "Hola",
      text: "Saludos",
    });
    expect(resendRequests).toHaveLength(0);
    expect(await sentCopies(owner.inboxId)).toHaveLength(1);
  });

  test("Cloudflare: an unverified sending domain fails cleanly, and the same send can be retried", async () => {
    const owner = await setupOwner();
    const refuse = vi.fn(async () => {
      throw Object.assign(new Error("Sender domain not verified"), { code: "E_SENDER_NOT_VERIFIED" });
    });

    const failed = await sendWith(
      { MAIL_PROVIDER: "cloudflare", EMAIL: { send: refuse } as unknown as SendEmail },
      owner,
      "cloudflare-retry-1",
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await sentCopies(owner.inboxId)).toHaveLength(0);

    const accept = vi.fn(async () => ({ messageId: "cf-2" }));
    const retried = await sendWith(
      { MAIL_PROVIDER: "cloudflare", EMAIL: { send: accept } as unknown as SendEmail },
      owner,
      "cloudflare-retry-1",
    );
    expect(retried.status).toBe(201);
    expect(await sentCopies(owner.inboxId)).toHaveLength(1);
  });

  test("an unknown provider is a server error, never a silent drop", async () => {
    const owner = await setupOwner();
    const response = await sendWith({ MAIL_PROVIDER: "sendgrid" }, owner, "unknown-provider-1");
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await sentCopies(owner.inboxId)).toHaveLength(0);
  });
});
