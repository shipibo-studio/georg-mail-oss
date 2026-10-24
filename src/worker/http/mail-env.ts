// The request context of the mail client: the database and the dashboard session. The hosted
// product's context (http/context.ts) extends it with API-key auth and analytics.
import type { Database } from "../db/client";
import type { Account, Plan } from "../db/schema";

/** The person signed in to the dashboard through Cloudflare Access, and their account. */
export interface DashboardSession {
  email: string;
  account: Account;
  plan: Plan;
}

export interface MailEnv {
  Bindings: Env;
  Variables: {
    db: Database;
    dashboard: DashboardSession;
  };
}
