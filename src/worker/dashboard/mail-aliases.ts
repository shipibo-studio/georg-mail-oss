// A personal mailbox's other addresses. The operator lists every address the install accepts in
// PERSONAL_MAILBOX_ADDRESSES; the owner picks which of them, besides the mailbox's own, are aliases.
// Mail to an alias lands in the same inbox, and the owner can send from it.
import { and, asc, eq, inArray } from "drizzle-orm";
import { PERSONAL_ALIASES_MAX } from "../config";
import type { Database } from "../db/client";
import { type Inbox, inboxes, mailboxAliases } from "../db/schema";
import { normalizeAddress } from "../email/email-address";
import { personalMailboxAddresses } from "../email/receive-email";
import { ApiError } from "../errors";
import { isUniqueViolation } from "../http/database-errors";

/** The mailbox's aliases, oldest first. */
export async function listAliases(db: Database, inboxId: string): Promise<string[]> {
  const rows = await db
    .select({ address: mailboxAliases.address })
    .from(mailboxAliases)
    .where(eq(mailboxAliases.inboxId, inboxId))
    .orderBy(asc(mailboxAliases.createdAt), asc(mailboxAliases.address));
  return rows.map((row) => row.address);
}

/** Every address the mailbox sends from and receives at: its own first, then its aliases. */
export async function mailboxAddresses(db: Database, mailbox: Inbox): Promise<string[]> {
  return [mailbox.address, ...(await listAliases(db, mailbox.id))];
}

/** Configured addresses that neither a mailbox nor an alias uses yet. */
export async function unclaimedAddresses(env: Pick<Env, "PERSONAL_MAILBOX_ADDRESSES">, db: Database) {
  const configured = [...personalMailboxAddresses(env)];
  if (configured.length === 0) return [];
  const [mailboxes, aliases] = await Promise.all([
    db.select({ address: inboxes.address }).from(inboxes).where(inArray(inboxes.address, configured)),
    db
      .select({ address: mailboxAliases.address })
      .from(mailboxAliases)
      .where(inArray(mailboxAliases.address, configured)),
  ]);
  const used = new Set([...mailboxes, ...aliases].map((row) => row.address));
  return configured.filter((address) => !used.has(address));
}

export async function addAlias(env: Env, db: Database, mailbox: Inbox, value: string): Promise<string> {
  const address = normalizeAddress(value);
  if (!(await unclaimedAddresses(env, db)).includes(address)) {
    throw new ApiError("validation_failed", `${address} cannot become an alias of this mailbox.`, {
      hint: "Use an address from PERSONAL_MAILBOX_ADDRESSES that no mailbox or alias uses yet.",
    });
  }
  if ((await listAliases(db, mailbox.id)).length >= PERSONAL_ALIASES_MAX) {
    throw new ApiError("plan_limit", `A mailbox has at most ${PERSONAL_ALIASES_MAX} aliases.`, {
      hint: "Remove an alias you no longer use first.",
    });
  }
  try {
    await db.insert(mailboxAliases).values({ address, inboxId: mailbox.id, createdAt: Date.now() });
  } catch (error) {
    // Claimed between the check and the insert.
    if (isUniqueViolation(error)) throw new ApiError("conflict", `${address} is already in use.`);
    throw error;
  }
  return address;
}

/** Stops the alias receiving mail; what it already received stays in the mailbox. */
export async function removeAlias(db: Database, mailbox: Inbox, value: string): Promise<void> {
  const address = value.trim().toLowerCase();
  const removed = await db
    .delete(mailboxAliases)
    .where(and(eq(mailboxAliases.inboxId, mailbox.id), eq(mailboxAliases.address, address)))
    .returning({ address: mailboxAliases.address });
  if (removed.length === 0) throw new ApiError("not_found", "This mailbox has no such alias.");
}
