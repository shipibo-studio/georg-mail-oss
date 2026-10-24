// The owner of a personal mailbox, for the mail client's tests: an account with a dashboard member
// and a mailbox, requests to its dashboard API and mail delivered to it.
import { env } from "cloudflare:test";
import { PERSONAL_MAILBOX_EXPIRES_AT } from "../src/worker/config";
import { createDatabase } from "../src/worker/db/client";
import { dashboardMembers, inboxes } from "../src/worker/db/schema";
import type { InboundEmail } from "../src/worker/email/receive-email";
import { createId } from "../src/worker/ids";
import { type DashboardRequest, dashboardFetch } from "./access-session";
import { buildEmail, createOwnerAccount, inboundEmail } from "./mail-helpers";
import { receiveMail } from "./mail-worker";

export interface Owner {
  accountId: string;
  member: string;
  address: string;
  inboxId: string;
}

export function randomName(): string {
  return createId("acc").slice(4, 14);
}

export async function setupOwner(options: { forwardTo?: string | null; mailbox?: boolean } = {}): Promise<Owner> {
  const db = createDatabase(env.DB);
  const accountId = await createOwnerAccount();
  const now = Date.now();
  const member = `owner-${randomName()}@example.test`;
  const address = `me-${randomName()}@${env.MAIL_DOMAIN}`;
  const inboxId = createId("inb");
  if (options.mailbox !== false) {
    await db.insert(inboxes).values({
      id: inboxId,
      accountId,
      kind: "personal",
      forwardTo: options.forwardTo === undefined ? "owner@gmail.test" : options.forwardTo,
      projectId: null,
      label: null,
      address,
      displayName: "Owner",
      messageCount: 0,
      createdAt: now,
      expiresAt: PERSONAL_MAILBOX_EXPIRES_AT,
    });
  }
  await db.insert(dashboardMembers).values({ email: member, accountId, createdAt: now });
  return { accountId, member, address, inboxId };
}

/** A request to the owner's mailbox API, signed in as the owner unless the request says otherwise. */
export function dashboard(owner: Owner, path: string, request: DashboardRequest = {}): Promise<Response> {
  return dashboardFetch(owner.member, `/mailbox${path}`, request);
}

export interface Delivery {
  attachment?: { filename: string; contentType: string; sizeBytes: number };
  subject?: string;
  text?: string;
  html?: string;
  headers?: string[];
  rawSize?: number;
  forward?: (rcptTo: string) => Promise<unknown>;
  listed?: boolean;
  /** Bindings to replace for this delivery, such as a rate limiter that refuses. */
  env?: Partial<Env>;
}

export async function deliver(owner: Owner, delivery: Delivery = {}) {
  const forwards: string[] = [];
  const raw = buildEmail({
    to: owner.address,
    from: "friend@acme.test",
    subject: delivery.subject ?? "Hello",
    text: delivery.text ?? "Hi there",
    ...(delivery.html ? { html: delivery.html } : {}),
    ...(delivery.attachment ? { attachment: delivery.attachment } : {}),
    headers: delivery.headers ?? [],
  });
  const base = inboundEmail(raw, { to: owner.address, from: "friend@acme.test" });
  const email: InboundEmail & { rejection: string | null } = {
    ...base,
    rawSize: delivery.rawSize ?? base.rawSize,
    forward:
      delivery.forward ??
      (async (rcptTo: string) => {
        forwards.push(rcptTo);
      }),
  };
  const listed = delivery.listed === false ? "" : owner.address;
  const result = await receiveMail(email, {
    ...env,
    ...delivery.env,
    PERSONAL_MAILBOX_ADDRESSES: `oi@example.test,${listed}`,
  });
  return { result, forwards, email };
}

export async function deliverStored(owner: Owner, delivery: Delivery = {}): Promise<string> {
  const { result } = await deliver(owner, delivery);
  if (result.status !== "stored") throw new Error(`expected stored, got ${result.status}`);
  return result.messageId;
}
