import { describe, expect, test, vi } from "vitest";
import { MAILTRAP_SEND_URL, RESEND_SEND_URL } from "../../src/worker/config";
import { createMailSender, MAIL_PROVIDERS } from "../../src/worker/sending/create-mail-sender";
import type { OutboundMessage } from "../../src/worker/sending/mail-sender";

const message: OutboundMessage = { from: { email: "a@b.test" }, to: [{ email: "c@d.test" }], subject: "S", text: "T" };

function fakeFetch(body: unknown) {
  return vi.fn<typeof fetch>(async () => Response.json(body));
}

describe("choosing the outbound provider", () => {
  test("offers Cloudflare, Resend and Mailtrap", () => {
    expect(MAIL_PROVIDERS).toEqual(["cloudflare", "resend", "mailtrap"]);
  });

  test("defaults to Mailtrap when MAIL_PROVIDER is not set", async () => {
    const fetchImpl = fakeFetch({ success: true, message_ids: ["m"] });
    await createMailSender({ MAILTRAP_API_KEY: "mt" }, fetchImpl).send(message);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(MAILTRAP_SEND_URL);
  });

  test("uses Resend with its key", async () => {
    const fetchImpl = fakeFetch({ id: "re" });
    await createMailSender({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_key" }, fetchImpl).send(message);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(RESEND_SEND_URL);
  });

  test("uses Cloudflare through the binding, without any key or fetch", async () => {
    const send = vi.fn(async () => ({ messageId: "cf" }));
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await createMailSender(
      { MAIL_PROVIDER: "cloudflare", EMAIL: { send } as unknown as SendEmail },
      fetchImpl,
    ).send(message);
    expect(result).toEqual({ messageIds: ["cf"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("refuses an unknown provider, and a chosen provider without its credentials", () => {
    expect(() => createMailSender({ MAIL_PROVIDER: "sendgrid" })).toThrow('Unknown MAIL_PROVIDER "sendgrid"');
    expect(() => createMailSender({ MAIL_PROVIDER: "resend" })).toThrow("RESEND_API_KEY is not configured.");
    expect(() => createMailSender({ MAIL_PROVIDER: "cloudflare" })).toThrow("send_email binding");
  });
});
