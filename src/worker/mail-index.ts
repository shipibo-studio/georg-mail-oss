// Entry point of the open-source mail client: the mailbox over HTTP and mail from Email Routing.
// Housekeeping (emptying Trash and Spam, removing uploads never sent) rides on that traffic at most
// once an hour, so the install needs no cron trigger; a cron, if configured, also runs it. See
// mail-app.ts and dashboard/mail-maintenance.ts.
import { DASHBOARD_BASE_PATH } from "./dashboard/dashboard-assets";
import { maintainWhenDue, runMailMaintenance } from "./dashboard/mail-maintenance";
import { receiveEmail } from "./email/receive-email";
import { mailApp } from "./mail-app";

/** Requests to the dashboard's API, not its static files, are the ones worth a housekeeping check. */
const DASHBOARD_API_PATH = `${DASHBOARD_BASE_PATH}/api/`;

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    if (new URL(request.url).pathname.startsWith(DASHBOARD_API_PATH)) context.waitUntil(maintainWhenDue(env));
    return mailApp.fetch(request, env, context);
  },

  async email(message, env, context) {
    const result = await receiveEmail(message, env);
    if (result.status === "stored" && result.parseError) {
      console.warn("Stored an email that could not be parsed", { messageId: result.messageId });
    }
    context.waitUntil(maintainWhenDue(env));
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(runMailMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
