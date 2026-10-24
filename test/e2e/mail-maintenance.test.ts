// Housekeeping without a cron trigger: the mail client's own traffic runs it at most once an hour.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PERSONAL_BIN_RETENTION_DAYS } from "../../src/worker/config";
import {
  claimMaintenance,
  MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_JOB,
  maintainWhenDue,
} from "../../src/worker/dashboard/mail-maintenance";
import { createDatabase } from "../../src/worker/db/client";
import { jobCursors, messages } from "../../src/worker/db/schema";
import mailWorker from "../../src/worker/mail-index";
import { ACCESS_CERTS_URL, accessJwk, accessToken } from "../access-session";
import { BASE_URL, buildEmail, inboundEmail } from "../mail-helpers";
import { deliverStored, type Owner, setupOwner } from "../mailbox-owner";

const db = createDatabase(env.DB);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    return realFetch(input, init);
  });
});

// Each test starts as if housekeeping never ran.
beforeEach(async () => {
  await db.delete(jobCursors).where(eq(jobCursors.name, MAINTENANCE_JOB));
});

/** A message moved to Trash longer ago than the retention period. */
async function oldTrash(owner: Owner): Promise<string> {
  const messageId = await deliverStored(owner);
  await db
    .update(messages)
    .set({ box: "trash", movedAt: Date.now() - (PERSONAL_BIN_RETENTION_DAYS + 1) * DAY_MS })
    .where(eq(messages.id, messageId));
  return messageId;
}

async function stillStored(messageId: string): Promise<boolean> {
  return (await db.select().from(messages).where(eq(messages.id, messageId))).length > 0;
}

async function lastRun(): Promise<number | null> {
  const [row] = await db.select().from(jobCursors).where(eq(jobCursors.name, MAINTENANCE_JOB));
  return row?.updatedAt ?? null;
}

describe("housekeeping without a cron", () => {
  test("runs once per hour, however many callers ask", async () => {
    const now = Date.now();
    const claims = await Promise.all([1, 2, 3].map(() => claimMaintenance(env.DB, now)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimMaintenance(env.DB, now + MAINTENANCE_INTERVAL_MS - 1)).toBe(false);
    expect(await claimMaintenance(env.DB, now + MAINTENANCE_INTERVAL_MS)).toBe(true);
  });

  test("when due, it empties old Trash; otherwise it leaves everything alone", async () => {
    const owner = await setupOwner();
    const first = await oldTrash(owner);
    expect(await maintainWhenDue(env)).toBe(true);
    expect(await stillStored(first)).toBe(false);

    const second = await oldTrash(owner);
    expect(await maintainWhenDue(env)).toBe(false);
    expect(await stillStored(second)).toBe(true);
  });

  test("incoming mail runs it", async () => {
    const owner = await setupOwner({ forwardTo: null });
    const old = await oldTrash(owner);
    const raw = buildEmail({ to: owner.address, from: "friend@acme.test", subject: "Wakes the housekeeping" });
    const context = createExecutionContext();
    await mailWorker.email(
      inboundEmail(raw, { to: owner.address, from: "friend@acme.test" }) as unknown as ForwardableEmailMessage,
      { ...env, PERSONAL_MAILBOX_ADDRESSES: owner.address },
      context,
    );
    await waitOnExecutionContext(context);
    expect(await stillStored(old)).toBe(false);
    expect(await lastRun()).not.toBeNull();
  });

  test("a request to the dashboard's API runs it, a static file does not", async () => {
    const owner = await setupOwner();
    const old = await oldTrash(owner);
    const fetchWorker = async (path: string, headers: HeadersInit = {}) => {
      const context = createExecutionContext();
      await mailWorker.fetch(new Request(`${BASE_URL}${path}`, { headers }), env, context);
      await waitOnExecutionContext(context);
    };

    await fetchWorker("/dashboard/inbox");
    expect(await lastRun()).toBeNull();
    expect(await stillStored(old)).toBe(true);

    await fetchWorker("/dashboard/api/mailbox", { "Cf-Access-Jwt-Assertion": await accessToken(owner.member) });
    expect(await stillStored(old)).toBe(false);
  });

  test("a failed pass is logged without mail details, and the next hour tries again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...env, MAIL_STORAGE: undefined } as unknown as Env;
    const owner = await setupOwner();
    await oldTrash(owner);
    expect(await maintainWhenDue(broken)).toBe(true);
    expect(error).toHaveBeenCalledWith("Mail maintenance failed", { error: "TypeError" });
    expect(JSON.stringify(error.mock.calls)).not.toContain(owner.address);
    error.mockRestore();
  });

  test("a cron, when the install has one, still runs it", async () => {
    const owner = await setupOwner();
    const old = await oldTrash(owner);
    const context = createExecutionContext();
    await mailWorker.scheduled(createScheduledController({ cron: "0 * * * *" }), env, context);
    await waitOnExecutionContext(context);
    expect(await stillStored(old)).toBe(false);
  });
});
