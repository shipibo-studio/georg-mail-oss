// The owner's per-sender Spam / Not spam choices for a personal mailbox, keyed by From address.
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { type SenderVerdict, senderRules } from "../db/schema";

export const ruleAddress = (fromAddress: string) => fromAddress.trim().toLowerCase();

export async function senderRuleFor(db: Database, inboxId: string, fromAddress: string): Promise<SenderVerdict | null> {
  const [rule] = await db
    .select({ verdict: senderRules.verdict })
    .from(senderRules)
    .where(and(eq(senderRules.inboxId, inboxId), eq(senderRules.address, ruleAddress(fromAddress))));
  return rule?.verdict ?? null;
}

/** Sets the rule for an address, or removes it with null. Returns the rule it replaced. */
export async function setSenderRule(
  db: Database,
  inboxId: string,
  fromAddress: string,
  verdict: SenderVerdict | null,
): Promise<SenderVerdict | null> {
  const address = ruleAddress(fromAddress);
  const previous = await senderRuleFor(db, inboxId, address);
  if (verdict === null) {
    await db.delete(senderRules).where(and(eq(senderRules.inboxId, inboxId), eq(senderRules.address, address)));
  } else {
    const updatedAt = Date.now();
    await db
      .insert(senderRules)
      .values({ inboxId, address, verdict, updatedAt })
      .onConflictDoUpdate({ target: [senderRules.inboxId, senderRules.address], set: { verdict, updatedAt } });
  }
  return previous;
}
