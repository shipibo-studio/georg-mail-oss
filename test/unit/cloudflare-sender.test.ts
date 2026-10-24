import { describe, expect, test, vi } from "vitest";
import { createCloudflareSender } from "../../src/worker/sending/cloudflare-sender";
import { MailSendError, type OutboundMessage } from "../../src/worker/sending/mail-sender";

const message: OutboundMessage = {
  from: { email: "oi@andalaosa.cl", name: "Andalaosa" },
  to: [{ email: "camila@estudio.cl" }, { email: "ana@estudio.cl", name: "Ana" }],
  cc: [{ email: "otro@estudio.cl" }],
  subject: "Propuesta",
  text: "Hola",
  html: "<p>Hola</p>",
  headers: { "In-Reply-To": "<a@b>" },
  attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: "JVBERi0=" }],
  category: "Personal",
};

function fakeBinding(result: { messageId: string } | Error) {
  const send = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { binding: { send } as unknown as SendEmail, send };
}

const bindingError = (code: string | undefined, text = "rejected") => Object.assign(new Error(text), { code });

async function sendError(error: Error): Promise<MailSendError> {
  const caught = await createCloudflareSender(fakeBinding(error).binding)
    .send(message)
    .catch((value: unknown) => value);
  if (!(caught instanceof MailSendError)) throw new Error("expected a MailSendError");
  return caught;
}

describe("Cloudflare Email Sending sender", () => {
  test("sends the builder form through the binding", async () => {
    const { binding, send } = fakeBinding({ messageId: "cf-1" });

    expect(await createCloudflareSender(binding).send(message)).toEqual({ messageIds: ["cf-1"] });

    expect(send).toHaveBeenCalledWith({
      from: { email: "oi@andalaosa.cl", name: "Andalaosa" },
      // Addresses without a name go as plain strings: the binding's named form requires a name.
      to: ["camila@estudio.cl", { email: "ana@estudio.cl", name: "Ana" }],
      cc: ["otro@estudio.cl"],
      subject: "Propuesta",
      text: "Hola",
      html: "<p>Hola</p>",
      headers: { "In-Reply-To": "<a@b>" },
      attachments: [{ content: "JVBERi0=", filename: "a.pdf", type: "application/pdf", disposition: "attachment" }],
    });
  });

  test("leaves out optional fields that are not set", async () => {
    const { binding, send } = fakeBinding({ messageId: "cf-2" });
    await createCloudflareSender(binding).send({
      from: { email: "a@b.test" },
      to: [{ email: "c@d.test" }],
      subject: "S",
    });
    expect(send).toHaveBeenCalledWith({ from: "a@b.test", to: ["c@d.test"], subject: "S" });
  });

  test.each([
    ["E_SENDER_NOT_VERIFIED", false],
    ["E_SENDER_DOMAIN_NOT_AVAILABLE", false],
    ["E_VALIDATION_ERROR", false],
    ["E_CONTENT_TOO_LARGE", false],
    ["E_RECIPIENT_SUPPRESSED", false],
    ["E_RATE_LIMIT_EXCEEDED", true],
    ["E_INTERNAL_SERVER_ERROR", true],
  ])("reports %s with retryable %s", async (code, retryable) => {
    const error = await sendError(bindingError(code));
    expect(error).toMatchObject({ status: null, retryable });
    expect(error.message).toContain(code);
  });

  test("treats an error without a code as an outage, and caps its text", async () => {
    const error = await sendError(bindingError(undefined, "x".repeat(10_000)));
    expect(error).toMatchObject({ retryable: true });
    expect(error.message).toContain("no code");
    expect(error.message.length).toBeLessThan(400);
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("refuses to start without the binding", () => {
    expect(() => createCloudflareSender(undefined)).toThrow('The "EMAIL" send_email binding is not configured.');
  });
});
