// Display preferences of one person who opens the dashboard: theme, accent, language, time format
// and sender avatars. Kept in D1 so they follow the person to every device; the browser keeps a
// copy in localStorage for the first paint. Only closed sets of values are accepted.
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { memberPreferences } from "../db/schema";

export const PREFERENCE_OPTIONS = {
  theme: ["system", "light", "dark"],
  accent: ["purple", "fuchsia", "green", "blue", "orange"],
  locale: ["en", "es-419", "pt-BR"],
  clock: ["24h", "12h"],
  avatars: ["faces", "initials"],
} as const;

export const preferencesSchema = z
  .strictObject({
    theme: z.enum(PREFERENCE_OPTIONS.theme).optional(),
    accent: z.enum(PREFERENCE_OPTIONS.accent).optional(),
    locale: z.enum(PREFERENCE_OPTIONS.locale).optional(),
    clock: z.enum(PREFERENCE_OPTIONS.clock).optional(),
    avatars: z.enum(PREFERENCE_OPTIONS.avatars).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Send at least one preference.");

export type Preferences = z.infer<typeof preferencesSchema>;

/** The person's saved preferences, or null before they change any. */
export async function readPreferences(db: Database, email: string): Promise<Preferences | null> {
  const [row] = await db
    .select({ preferences: memberPreferences.preferences })
    .from(memberPreferences)
    .where(eq(memberPreferences.email, email))
    .limit(1);
  return (row?.preferences as Preferences | undefined) ?? null;
}

/** Merges the changed preferences into what is saved and returns the result. */
export async function savePreferences(db: Database, email: string, changes: Preferences): Promise<Preferences> {
  const merged = { ...(await readPreferences(db, email)), ...changes };
  const now = Date.now();
  await db
    .insert(memberPreferences)
    .values({ email, preferences: merged, updatedAt: now })
    .onConflictDoUpdate({ target: memberPreferences.email, set: { preferences: merged, updatedAt: now } });
  return merged;
}
