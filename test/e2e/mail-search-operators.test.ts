// Search operators in the personal mailbox, against the real FTS5 index: "exact phrases",
// -exclusions, from:, has:attachment, after: and before: (in the owner's time zone).
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ACCESS_CERTS_URL, accessJwk } from "../access-session";
import { json } from "../mail-helpers";
import { dashboard, deliverStored, type Owner, setupOwner } from "../mailbox-owner";

type Results = { messages: { id: string }[] };

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    return realFetch(input, init);
  });
});

async function found(owner: Owner, q: string, extra: Record<string, unknown> = {}) {
  const response = await dashboard(owner, "/messages/search", { method: "POST", body: { q, ...extra } });
  expect(response.status).toBe(200);
  return (await json<Results>(response)).messages.map((message) => message.id).sort();
}

const setReceivedAt = (messageId: string, iso: string) =>
  env.DB.prepare("UPDATE messages SET received_at = ? WHERE id = ?").bind(Date.parse(iso), messageId).run();

describe("search operators", () => {
  test('"exact phrases" match words together and in order', async () => {
    const owner = await setupOwner();
    const together = await deliverStored(owner, { subject: "Nos vemos", text: "Hasta luego, Camila" });
    await deliverStored(owner, { subject: "Otra", text: "Luego hablamos, hasta el lunes" });
    expect(await found(owner, '"hasta luego"')).toEqual([together]);
  });

  test("-words and -phrases leave messages out, even with nothing else to match", async () => {
    const owner = await setupOwner();
    const invoice = await deliverStored(owner, { subject: "Factura abril", text: "Adjunta" });
    const draft = await deliverStored(owner, { subject: "Factura borrador", text: "Sin enviar" });
    const news = await deliverStored(owner, { subject: "Newsletter", text: "No responder a este correo" });
    expect(await found(owner, "factura -borrador")).toEqual([invoice]);
    expect(await found(owner, '-"no responder"')).toEqual([draft, invoice].sort());
    expect(await found(owner, "-newsletter -borrador")).toEqual([invoice]);
    expect(news).toBeTruthy();
  });

  test("from: matches part of the sender's address or name, and -from: leaves a sender out", async () => {
    const owner = await setupOwner();
    const bank = await deliverStored(owner, { from: "alertas@banco-seguro.test", subject: "Movimiento" });
    const friend = await deliverStored(owner, { subject: "Movimiento" });
    expect(await found(owner, "from:banco")).toEqual([bank]);
    expect(await found(owner, "from:friend")).toEqual([friend]);
    // The name counts too, in any case: both senders are "Acme <…>", and only one address says acme.
    expect(await found(owner, "from:ACME")).toEqual([bank, friend].sort());
    expect(await found(owner, "movimiento -from:banco")).toEqual([friend]);
    // LIKE wildcards are plain characters.
    expect(await found(owner, "from:%")).toEqual([]);
  });

  test("has:attachment and -has:attachment", async () => {
    const owner = await setupOwner();
    const withFile = await deliverStored(owner, {
      subject: "Contrato",
      attachment: { filename: "contrato.pdf", contentType: "application/pdf", sizeBytes: 600 },
    });
    const without = await deliverStored(owner, { subject: "Contrato" });
    expect(await found(owner, "has:attachment")).toEqual([withFile]);
    expect(await found(owner, "contrato -has:attachment")).toEqual([without]);
  });

  test("after: and before: are days where the owner is", async () => {
    const owner = await setupOwner();
    const september = await deliverStored(owner, { subject: "Pago" });
    const firstOfOctober = await deliverStored(owner, { subject: "Pago" });
    const november = await deliverStored(owner, { subject: "Pago" });
    await setReceivedAt(september, "2026-09-30T20:00:00Z");
    // 01:00 UTC on Oct 1 is still Sep 30 in Santiago (UTC-3).
    await setReceivedAt(firstOfOctober, "2026-10-01T01:00:00Z");
    await setReceivedAt(november, "2026-11-02T12:00:00Z");

    // Without the browser's offset, days are UTC.
    expect(await found(owner, "pago after:2026-10-01")).toEqual([firstOfOctober, november].sort());
    expect(await found(owner, "pago after:2026-10-01", { timezoneOffset: 180 })).toEqual([november]);
    expect(await found(owner, "before:2026-10-01 after:2026-09-01", { timezoneOffset: 180 })).toEqual(
      [september, firstOfOctober].sort(),
    );
  });

  test("an out-of-range time zone is refused, and another owner's mail is never found", async () => {
    const owner = await setupOwner();
    await deliverStored(owner, { subject: "Secreto" });
    const response = await dashboard(owner, "/messages/search", {
      method: "POST",
      body: { q: "secreto", timezoneOffset: 100_000 },
    });
    expect(response.status).toBe(400);
    const stranger = await setupOwner();
    expect(await found(stranger, "secreto")).toEqual([]);
    expect(await found(stranger, "has:attachment")).toEqual([]);
  });
});
