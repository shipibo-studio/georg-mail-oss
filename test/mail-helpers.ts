// Helpers for the mail client's tests: accounts without API keys, raw messages and the inbound
// stand-in. Part of the open-source export, so nothing here may import the hosted product.
import { env } from "cloudflare:test";
import { createDatabase } from "../src/worker/db/client";
import { accounts } from "../src/worker/db/schema";
import type { InboundEmail } from "../src/worker/email/receive-email";
import { createId } from "../src/worker/ids";

export const BASE_URL = "https://georg.test";

/** An account with no keys: the owner reaches it only through the dashboard. */
export async function createOwnerAccount(planId = "paid"): Promise<string> {
  const accountId = createId("acc");
  await createDatabase(env.DB)
    .insert(accounts)
    .values({ id: accountId, name: `Test ${planId}`, planId, createdAt: Date.now() });
  return accountId;
}

/** Whether a URL is on exactly this host: a prefix check would also match "host.evil.test". */
export function isHost(url: string, host: string): boolean {
  return new URL(url).hostname === host;
}

export async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface EmailOptions {
  from?: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  attachment?: { filename: string; contentType: string; sizeBytes: number };
  /** Raw header lines placed first, as a receiving server would prepend them. */
  headers?: string[];
}

/** Builds an RFC 822 message; attachments are filled with deterministic bytes and base64-encoded. */
export function buildEmail(options: EmailOptions): string {
  const boundary = "georg-test-boundary";
  const headers = [
    ...(options.headers ?? []),
    `From: Acme <${options.from ?? "no-reply@acme.test"}>`,
    `To: ${options.to}`,
    `Subject: ${options.subject ?? "Test message"}`,
    `Message-ID: <${crypto.randomUUID()}@acme.test>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const bodies: string[] = [];
  if (options.text !== undefined) bodies.push(`Content-Type: text/plain; charset=utf-8\r\n\r\n${options.text}`);
  if (options.html !== undefined) bodies.push(`Content-Type: text/html; charset=utf-8\r\n\r\n${options.html}`);
  // Like real email clients: text and HTML are alternatives of the same body, and a reader sees one.
  const alternativeBoundary = "georg-test-alternative";
  const parts =
    bodies.length > 1
      ? [
          `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n${bodies
            .map((body) => `--${alternativeBoundary}\r\n${body}\r\n`)
            .join("")}--${alternativeBoundary}--`,
        ]
      : bodies;
  if (options.attachment) {
    const bytes = new Uint8Array(options.attachment.sizeBytes).map((_, index) => index % 251);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary).replace(/.{76}/g, "$&\r\n");
    parts.push(
      [
        `Content-Type: ${options.attachment.contentType}; name="${options.attachment.filename}"`,
        `Content-Disposition: attachment; filename="${options.attachment.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        base64,
      ].join("\r\n"),
    );
  }
  const body = `${parts.map((part) => `--${boundary}\r\n${part}\r\n`).join("")}--${boundary}--\r\n`;
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** In-memory stand-in for the Email Workers message, recording the rejection reason. */
export function inboundEmail(
  raw: string,
  envelope: { from?: string; to: string },
): InboundEmail & {
  rejection: string | null;
} {
  const bytes = new TextEncoder().encode(raw);
  return {
    from: envelope.from ?? "no-reply@acme.test",
    to: envelope.to,
    raw: new Response(bytes).body as ReadableStream<Uint8Array>,
    rawSize: bytes.byteLength,
    rejection: null,
    setReject(reason: string) {
      this.rejection = reason;
    },
  };
}
