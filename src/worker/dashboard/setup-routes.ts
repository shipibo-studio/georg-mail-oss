// First run of a self-hosted mail client: the person Cloudflare Access lets in creates the account,
// their mailbox and their dashboard membership in one step. It works only while the install has no
// dashboard member, so the first owner closes it; who may try is decided by the Access policy.
import { inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { PERSONAL_MAILBOX_EXPIRES_AT } from "../config";
import { inboxes } from "../db/schema";
import { normalizeAddress } from "../email/email-address";
import { personalMailboxAddresses } from "../email/receive-email";
import { ApiError } from "../errors";
import type { MailEnv } from "../http/mail-env";
import { validate } from "../http/validation";
import { createId } from "../ids";
import { accessIdentity } from "./dashboard-session";

/** The plan of every self-hosted account (migration 0028). */
export const SELF_HOSTED_PLAN_ID = "self-hosted";
const MAX_DISPLAY_NAME_LENGTH = 100;
/** Each statement of the setup runs only while nobody owns the install yet. */
const WHILE_UNCLAIMED = "WHERE NOT EXISTS (SELECT 1 FROM dashboard_members)";

const setupSchema = z.object({
  address: z.string().max(320),
  displayName: z.string().trim().max(MAX_DISPLAY_NAME_LENGTH).optional(),
  forward: z.boolean().default(true),
});

async function isClaimed(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM dashboard_members LIMIT 1").first()) !== null;
}

/** Configured mailbox addresses that no inbox uses yet. */
async function availableAddresses(context: Context<MailEnv>): Promise<string[]> {
  const configured = [...personalMailboxAddresses(context.env)];
  if (configured.length === 0) return [];
  const taken = await context
    .get("db")
    .select({ address: inboxes.address })
    .from(inboxes)
    .where(inArray(inboxes.address, configured));
  const used = new Set(taken.map((row) => row.address));
  return configured.filter((address) => !used.has(address));
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * Whether the copy of new mail may go to the owner's sign-in address. Not when it is on a domain
 * this install receives (the mailbox's own, MAIL_DOMAIN or a subdomain of them): Email Routing would
 * bring the copy back to this Worker, a loop, and the owner would lose the one place mail reaches
 * them when the mailbox cannot be opened.
 */
export function canForwardCopy(ownerEmail: string, receivingDomains: string[]): boolean {
  const ownerDomain = domainOf(ownerEmail);
  return !receivingDomains.some((domain) => ownerDomain === domain || ownerDomain.endsWith(`.${domain}`));
}

function receivingDomains(env: Env): string[] {
  return [env.MAIL_DOMAIN.toLowerCase(), ...[...personalMailboxAddresses(env)].map(domainOf)];
}

const alreadySetUp = () =>
  new ApiError("conflict", "This mail client is already set up.", {
    hint: "Ask its owner to add your email to the dashboard members.",
  });

export const setupRoutes = new Hono<MailEnv>()
  .get("/", async (context) => {
    const email = await accessIdentity(context);
    if (await isClaimed(context.env.DB)) return context.json({ needed: false });
    return context.json({
      needed: true,
      email,
      addresses: await availableAddresses(context),
      canForward: canForwardCopy(email, receivingDomains(context.env)),
    });
  })

  .post("/", validate("json", setupSchema), async (context) => {
    const email = await accessIdentity(context);
    if (await isClaimed(context.env.DB)) throw alreadySetUp();
    const body = context.req.valid("json");
    const address = normalizeAddress(body.address);
    if (!(await availableAddresses(context)).includes(address)) {
      throw new ApiError("validation_failed", `${address} is not a mailbox this install can create.`, {
        hint: "Use one of the addresses in PERSONAL_MAILBOX_ADDRESSES that no mailbox has yet.",
      });
    }
    const displayName = body.displayName || null;
    // Without a safe address there is no copy at all, and Settings shows the switch as unavailable.
    const forwardTo = canForwardCopy(email, receivingDomains(context.env)) ? email : null;
    const accountId = createId("acc");
    const now = Date.now();
    const db = context.env.DB;
    // One batch, one transaction: two people finishing at once cannot both become the owner.
    const [, , membership] = await db.batch([
      db
        .prepare(`INSERT INTO accounts (id, name, plan_id, created_at) SELECT ?, ?, ?, ? ${WHILE_UNCLAIMED}`)
        .bind(accountId, displayName ?? address, SELF_HOSTED_PLAN_ID, now),
      db
        .prepare(
          `INSERT INTO inboxes (id, account_id, kind, forward_to, forward_enabled, address, display_name, created_at, expires_at)
           SELECT ?, ?, 'personal', ?, ?, ?, ?, ?, ? ${WHILE_UNCLAIMED}`,
        )
        .bind(
          createId("inb"),
          accountId,
          forwardTo,
          forwardTo && body.forward ? 1 : 0,
          address,
          displayName,
          now,
          PERSONAL_MAILBOX_EXPIRES_AT,
        ),
      db
        .prepare(`INSERT INTO dashboard_members (email, account_id, created_at) SELECT ?, ?, ? ${WHILE_UNCLAIMED}`)
        .bind(email, accountId, now),
    ]);
    if (!membership?.meta.changes) throw alreadySetUp();
    return context.json({ address, owner: email }, 201);
  });
