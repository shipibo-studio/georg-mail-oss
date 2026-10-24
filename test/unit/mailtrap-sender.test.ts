import { env } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";
import { MAILTRAP_SEND_URL } from "../../src/worker/config";
import { createMailSender } from "../../src/worker/sending/create-mail-sender";
import { MailSendError, type OutboundMessage } from "../../src/worker/sending/mail-sender";
import { createMailtrapSender } from "../../src/worker/sending/mailtrap-sender";

const TOKEN = "test-mailtrap-token";

const message: OutboundMessage = {
  from: { email: "hello@demomailtrap.co", name: "Georg mail" },
  to: [{ email: "hello@example.com" }],
  subject: "You are awesome!",
  text: "Congrats for sending test email with Mailtrap!",
  category: "Integration Test",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

const fakeBody = (fetchImpl: ReturnType<typeof fakeFetch>) => fetchImpl.mock.calls[0]?.[1]?.body;

async function sendError(fetchImpl: typeof fetch): Promise<MailSendError> {
  const error = await createMailtrapSender({ apiToken: TOKEN, fetch: fetchImpl })
    .send(message)
    .catch((caught: unknown) => caught);
  if (!(error instanceof MailSendError)) throw new Error("expected a MailSendError");
  return error;
}

describe("Mailtrap sender", () => {
  test("posts the message to the send API with the token in the Authorization header", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, message_ids: ["msg-1"] }));

    const result = await createMailtrapSender({ apiToken: TOKEN, fetch: fetchImpl }).send(message);

    expect(result).toEqual({ messageIds: ["msg-1"] });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(MAILTRAP_SEND_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual(message);
    expect(String(init?.body)).not.toContain(TOKEN);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("ignores message ids that are not strings", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, message_ids: ["msg-1", 42, null] }));
    expect(await createMailtrapSender({ apiToken: TOKEN, fetch: fetchImpl }).send(message)).toEqual({
      messageIds: ["msg-1"],
    });
    const noIds = fakeFetch(jsonResponse({ success: true }));
    expect(await createMailtrapSender({ apiToken: TOKEN, fetch: noIds }).send(message)).toEqual({ messageIds: [] });
  });

  test("reports a rejected request as not retryable, with the provider's reasons", async () => {
    const error = await sendError(fakeFetch(jsonResponse({ success: false, errors: ["Unauthorized"] }, 401)));
    expect(error).toMatchObject({ status: 401, retryable: false });
    expect(error.message).toContain("Unauthorized");
    expect(error.message).not.toContain(TOKEN);
  });

  test.each([429, 500, 503])("reports HTTP %i as retryable", async (status) => {
    const error = await sendError(fakeFetch(jsonResponse({ success: false, errors: ["try later"] }, status)));
    expect(error).toMatchObject({ status, retryable: true });
  });

  test("treats a 200 without success: true as a failure", async () => {
    const error = await sendError(fakeFetch(jsonResponse({ errors: ["sender domain not verified"] })));
    expect(error).toMatchObject({ status: 200, retryable: false });
    expect(error.message).toContain("sender domain not verified");
  });

  test("survives a non-JSON error body", async () => {
    const error = await sendError(fakeFetch(new Response("<html>Bad gateway</html>", { status: 502 })));
    expect(error).toMatchObject({ status: 502, retryable: true });
    expect(error.message).toContain("no details");
  });

  test("caps and filters hostile provider error text", async () => {
    const huge = "x".repeat(10_000);
    const error = await sendError(fakeFetch(jsonResponse({ success: false, errors: [huge, { html: "<b>" }] }, 422)));
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain("<b>");
  });

  test("reports network failures and timeouts as retryable", async () => {
    const network = await sendError(fakeFetch(new TypeError("fetch failed")));
    expect(network).toMatchObject({ status: null, retryable: true });
    expect(network.cause).toBeInstanceOf(TypeError);

    const timeout = await sendError(fakeFetch(new DOMException("The operation timed out.", "TimeoutError")));
    expect(timeout).toMatchObject({ status: null, retryable: true });
  });

  test("names attachments the way Mailtrap expects", async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, message_ids: ["msg-1"] }));
    await createMailtrapSender({ apiToken: TOKEN, fetch: fetchImpl }).send({
      ...message,
      attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", content: "JVBERi0=" }],
    });
    const body = JSON.parse(String(fakeBody(fetchImpl)));
    expect(body.attachments).toEqual([
      { content: "JVBERi0=", filename: "invoice.pdf", type: "application/pdf", disposition: "attachment" },
    ]);
  });

  test("refuses to start without a token", () => {
    expect(() => createMailtrapSender({ apiToken: "" })).toThrow("MAILTRAP_API_KEY is not configured.");
  });

  test("the factory uses the Worker secret, which tests replace with a fake token", async () => {
    expect(env.MAILTRAP_API_KEY).toBe(TOKEN);
    const fetchImpl = fakeFetch(jsonResponse({ success: true, message_ids: ["msg-2"] }));

    await createMailSender(env, fetchImpl).send(message);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });
});
