// The Worker the mail client's tests run against: the mail client's own entry point.
import { receiveEmail } from "../src/worker/email/receive-email";
import worker from "../src/worker/mail-index";

export const mailWorker = worker;
/** The schedule that empties Trash and Spam and deletes files never sent. */
export const MAIL_CRON = "0 * * * *";
/** Receives one message as the Worker's email handler does, returning what happened to it. */
export const receiveMail = (email: Parameters<typeof receiveEmail>[0], env: Env) => receiveEmail(email, env);
