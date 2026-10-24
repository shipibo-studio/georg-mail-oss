// The mail client's housekeeping (emptying Trash and Spam after their retention, deleting files that
// were never sent) without needing a cron trigger: Workers Free allows only five per account, so a
// self-hosted install may have none to spare. Requests and incoming mail run it at most once an
// hour; a cron, when there is one, runs it too.
import { emptyOldBins } from "./mail-boxes";
import { purgeStaleUploads } from "./mail-uploads";

type MaintenanceEnv = Pick<Env, "DB" | "MAIL_STORAGE">;

/** Its row in job_cursors, which records when it last ran. */
export const MAINTENANCE_JOB = "mail-maintenance";
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** One pass of every cleanup; each deletes a bounded batch, so a pass stays within the CPU limit. */
export async function runMailMaintenance(env: MaintenanceEnv, now = Date.now()): Promise<void> {
  await emptyOldBins(env, now);
  await purgeStaleUploads(env, now);
}

/**
 * Takes this interval's run: true for exactly one caller, however many requests arrive at once,
 * because the check and the update are one statement.
 */
export async function claimMaintenance(db: D1Database, now = Date.now()): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO job_cursors (name, position, updated_at) VALUES (?, '', ?)
       ON CONFLICT (name) DO UPDATE SET updated_at = excluded.updated_at
       WHERE job_cursors.updated_at <= ?`,
    )
    .bind(MAINTENANCE_JOB, now, now - MAINTENANCE_INTERVAL_MS)
    .run();
  return result.meta.changes > 0;
}

/** Runs the housekeeping if an hour has passed since it last did; returns whether it ran. */
export async function maintainWhenDue(env: MaintenanceEnv, now = Date.now()): Promise<boolean> {
  if (!(await claimMaintenance(env.DB, now))) return false;
  try {
    await runMailMaintenance(env, now);
  } catch (error) {
    // The next interval tries again; nothing about the mail itself is logged.
    console.error("Mail maintenance failed", { error: error instanceof Error ? error.name : "unknown" });
  }
  return true;
}
