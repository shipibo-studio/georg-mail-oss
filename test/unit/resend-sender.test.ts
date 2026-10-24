import { describe, expect, test, vi } from "vitest";
import { RESEND_SEND_URL } from "../../src/worker/config";
import { MailSendError, type OutboundMessage } from "../../src/worker/sending/mail-sender";
import { createResendSender, formatAddress } from "../../src/worker/sending/resend-sender";

const KEY = "re_test_key";

const message: OutboundMessage = {
  from: { email: "oi@andalaosa.cl", name: "Andalaosa" },
  to: [{ email: "camila@estudio.cl" }],
  cc: [{ email: "otro@estudio.cl", name: "Otro" }],
  subject: "Propuesta",
  text: "Hola",
  headers: { "In-Reply-To": "<a@b>" },
  category: "Integration Test",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

async function sendError(fetchImpl: typeof fetch): Promise<MailSendError> {
  const error = await createResendSender({ apiKey: KEY, fetch: fetchImpl })
    .send(message)
    .catch((caught: unknown) => caught);
  if (!(error instanceof MailSendError)) throw new Error("expected a MailSendError");
  return error;
}

describe("Resend sender", () => {
  test("posts Resend's format with the key only in the Authorization header", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ id: "re-1" }));

    const result = await createResendSender({ apiKey: KEY, fetch: fetchImpl }).send({
      ...message,
      attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: "JVBERi0=" }],
    });

    expect(result).toEqual({ messageIds: ["re-1"] });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_SEND_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(String(init?.body)).not.toContain(KEY);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      from: '"Andalaosa" <oi@andalaosa.cl>',
      to: ["camila@estudio.cl"],
      cc: ['"Otro" <otro@estudio.cl>'],
      subject: "Propuesta",
      text: "Hola",
      headers: { "In-Reply-To": "<a@b>" },
      attachments: [{ filename: "a.pdf", content: "JVBERi0=", content_type: "application/pdf" }],
      // Resend tags take letters, digits, "_" and "-" only.
      tags: [{ name: "category", value: "Integration_Test" }],
    });
  });

  test("leaves out optional fields that are not set", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ id: "re-2" }));
    await createResendSender({ apiKey: KEY, fetch: fetchImpl }).send({
      from: { email: "oi@andalaosa.cl" },
      to: [{ email: "a@b.test" }],
      subject: "S",
      html: "<p>Hi</p>",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      from: "oi@andalaosa.cl",
      to: ["a@b.test"],
      subject: "S",
      html: "<p>Hi</p>",
    });
  });

  test.each([
    [{ email: "a@b.test" }, "a@b.test"],
    [{ email: "a@b.test", name: "Ana" }, '"Ana" <a@b.test>'],
    [{ email: "a@b.test", name: 'Ana "the boss" \\ Pérez' }, '"Ana \\"the boss\\" \\\\ Pérez" <a@b.test>'],
    // A line break in a name would start a new header (Bcc: …); it is flattened inside the quotes.
    [{ email: "a@b.test", name: "Ana\r\nBcc: victim@evil.test" }, '"Ana Bcc: victim@evil.test" <a@b.test>'],
    [{ email: "a@b.test", name: "  " }, "a@b.test"],
  ])("formats %j safely", (address, expected) => {
    expect(formatAddress(address)).toBe(expected);
    expect(formatAddress(address)).not.toMatch(/[\r\n]/);
  });

  test("reports a rejected request as not retryable, with Resend's message", async () => {
    const error = await sendError(
      fakeFetch(jsonResponse({ name: "validation_error", message: "Domain not verified" }, 403)),
    );
    expect(error).toMatchObject({ status: 403, retryable: false });
    expect(error.message).toContain("Domain not verified");
    expect(error.message).not.toContain(KEY);
  });

  test.each([429, 500, 503])("reports HTTP %i as retryable", async (status) => {
    expect(await sendError(fakeFetch(jsonResponse({ message: "later" }, status)))).toMatchObject({
      status,
      retryable: true,
    });
  });

  test("treats a 200 without an id as a failure, and survives non-JSON and hostile bodies", async () => {
    expect(await sendError(fakeFetch(jsonResponse({})))).toMatchObject({ status: 200, retryable: false });
    const html = await sendError(fakeFetch(new Response("<html>Bad gateway</html>", { status: 502 })));
    expect(html.message).toContain("no details");
    const huge = await sendError(fakeFetch(jsonResponse({ message: "x".repeat(10_000) }, 422)));
    expect(huge.message.length).toBeLessThan(400);
  });

  test("reports network failures and timeouts as retryable", async () => {
    const network = await sendError(fakeFetch(new TypeError("fetch failed")));
    expect(network).toMatchObject({ status: null, retryable: true });
    expect(network.cause).toBeInstanceOf(TypeError);
  });

  test("refuses to start without a key", () => {
    expect(() => createResendSender({ apiKey: "" })).toThrow("RESEND_API_KEY is not configured.");
  });
});
