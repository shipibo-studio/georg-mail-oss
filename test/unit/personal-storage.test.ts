import { describe, expect, test } from "vitest";
import { HeaderBlockCollector } from "../../src/worker/email/header-block";
import { extractAttachment } from "../../src/worker/email/parse-email";
import { downloadHeaders, safeFilename } from "../../src/worker/http/downloads";
import { PERSONAL_ROOT_PREFIX, RAW_ROOT_PREFIX, rawMessageKey } from "../../src/worker/storage/raw-messages";
import { buildEmail } from "../mail-helpers";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

function collect(chunks: string[], maxBytes = 1_000): string {
  const collector = new HeaderBlockCollector(maxBytes);
  for (const chunk of chunks) collector.push(encode(chunk));
  return decode(collector.message());
}

describe("HeaderBlockCollector", () => {
  test("stops at the empty line that ends the headers", () => {
    expect(collect(["From: a@b.test\r\nSubject: Hi\r\n\r\nBody that is never kept"])).toBe(
      "From: a@b.test\r\nSubject: Hi\r\n\r\n",
    );
  });

  test("finds the end even when it straddles two chunks", () => {
    expect(collect(["Subject: Hi\r\n\r", "\nBody"])).toBe("Subject: Hi\r\n\r\n");
    expect(collect(["Subject: Hi\r", "\n", "\r", "\nBody"])).toBe("Subject: Hi\r\n\r\n");
  });

  test("accepts bare line feeds", () => {
    expect(collect(["Subject: Hi\n\nBody"])).toBe("Subject: Hi\r\n\r\n");
  });

  test("ignores everything after the headers ended", () => {
    expect(collect(["Subject: Hi\r\n\r\n", "From: late@b.test\r\n\r\n"])).toBe("Subject: Hi\r\n\r\n");
  });

  test("keeps at most maxBytes when the headers never end", () => {
    expect(collect(["X".repeat(50), "Y".repeat(50)], 60)).toBe(`${"X".repeat(50)}${"Y".repeat(10)}\r\n\r\n`);
  });
});

describe("raw storage keys", () => {
  test("keep personal originals out of the raw/ prefix that a lifecycle rule expires", () => {
    expect(rawMessageKey("acc_1", "inb_1", "msg_1")).toBe(`${RAW_ROOT_PREFIX}acc_1/inb_1/msg_1.eml`);
    expect(rawMessageKey("acc_1", "inb_1", "msg_1", PERSONAL_ROOT_PREFIX)).toBe("personal/acc_1/inb_1/msg_1.eml");
  });
});

describe("downloads", () => {
  test.each([
    ["propuesta.pdf", "propuesta.pdf"],
    ["../../etc/passwd", "_.._etc_passwd"],
    ['evil";.html', "evil_.html"],
    ["...hidden", "hidden"],
    ["   ", "fallback.bin"],
    [null, "fallback.bin"],
    [`a${String.fromCodePoint(0)}b\r\nc`, "a_b_c"],
    ["x".repeat(400), "x".repeat(150)],
  ])("names %j safely", (name, expected) => {
    expect(safeFilename(name, "fallback.bin")).toBe(expected);
  });

  test("are opaque, sandboxed and never cached", () => {
    const headers = downloadHeaders("Factura número 1.pdf");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toBe(
      `attachment; filename="Factura n_mero 1.pdf"; filename*=UTF-8''${encodeURIComponent("Factura número 1.pdf")}`,
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
    expect(headers["Cache-Control"]).toBe("private, no-store");
  });
});

describe("extractAttachment", () => {
  const raw = encode(
    buildEmail({
      to: "hello@example.com",
      text: "See attached",
      attachment: { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 600 },
    }),
  ).buffer as ArrayBuffer;

  test("returns the content of the matching attachment", async () => {
    const content = await extractAttachment(raw, {
      filename: "a.pdf",
      contentType: "application/pdf",
      sizeBytes: 600,
      ordinal: 0,
    });
    expect(content?.byteLength).toBe(600);
    expect(content?.[260]).toBe(260 % 251);
  });

  test.each([
    ["another name", { filename: "b.pdf", contentType: "application/pdf", sizeBytes: 600, ordinal: 0 }],
    ["another size", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 601, ordinal: 0 }],
    ["a later duplicate", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 600, ordinal: 1 }],
  ])("returns nothing for %s", async (_case, query) => {
    expect(await extractAttachment(raw, query)).toBeNull();
  });
});
