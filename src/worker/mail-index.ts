// Entry point of the open-source mail client: the mailbox over HTTP, mail from Email Routing, and a
// cron that empties Trash and Spam and removes uploads never sent. See mail-app.ts.
import { emptyOldBins } from "./dashboard/mail-boxes";
import { purgeStaleUploads } from "./dashboard/mail-uploads";
import { receiveEmail } from "./email/receive-email";
import { mailApp } from "./mail-app";

export default {
  fetch: mailApp.fetch,

  async email(message, env, _context) {
    const result = await receiveEmail(message, env);
    if (result.status === "stored" && result.parseError) {
      console.warn("Stored an email that could not be parsed", { messageId: result.messageId });
    }
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(
      (async () => {
        await emptyOldBins(env);
        await purgeStaleUploads(env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
