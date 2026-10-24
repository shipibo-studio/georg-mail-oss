import { describe, expect, test } from "vitest";
import { cleanContentType, cleanFilename, isBlockedFile, toBase64 } from "../../src/worker/dashboard/mail-uploads";

const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

describe("upload names and types", () => {
  test("keeps ordinary names, accents included", () => {
    expect(cleanFilename("Propuesta año 2026.pdf")).toBe("Propuesta año 2026.pdf");
  });

  test("removes folders, line breaks and invisible characters that disguise a name", () => {
    expect(cleanFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(cleanFilename("C:\\Users\\a.pdf")).toBe("C:_Users_a.pdf");
    expect(cleanFilename("a\r\nContent-Type: text/html.pdf")).toBe("a__Content-Type: text_html.pdf");
    expect(cleanFilename(`invoice${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`)).toBe("invoice_fdp.exe");
    expect(cleanFilename(`a${ZERO_WIDTH_SPACE}b.txt`)).toBe("a_b.txt");
  });

  test("empty names get a neutral one, and long names are cut", () => {
    expect(cleanFilename("")).toBe("attachment");
    expect(cleanFilename("   ")).toBe("attachment");
    expect(cleanFilename("x".repeat(300))).toHaveLength(200);
  });

  test("accepts media types without parameters, and falls back for anything else", () => {
    expect(cleanContentType("application/pdf")).toBe("application/pdf");
    expect(cleanContentType("Image/PNG; charset=binary")).toBe("image/png");
    expect(cleanContentType("text/html\r\nX-Evil: 1")).toBe("application/octet-stream");
    expect(cleanContentType("pdf")).toBe("application/octet-stream");
    expect(cleanContentType(undefined)).toBe("application/octet-stream");
  });

  test("refuses programs and scripts that mail services reject", () => {
    for (const name of ["setup.exe", "run.BAT", "macro.vbs", "app.js", "disk.iso", "a.pdf.scr"]) {
      expect(isBlockedFile(name)).toBe(true);
    }
    for (const name of ["a.pdf", "photo.jpeg", "notes.txt", "data.zip", "exe.pdf", "page.html"]) {
      expect(isBlockedFile(name)).toBe(false);
    }
  });

  test("encodes to base64 natively", () => {
    expect(toBase64(new TextEncoder().encode("hola"))).toBe("aG9sYQ==");
    expect(toBase64(new Uint8Array([0, 255, 128]))).toBe("AP+A");
  });
});
