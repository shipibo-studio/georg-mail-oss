import { describe, expect, test } from "vitest";
import { extractLinks } from "../../src/worker/email/extract-links";

describe("extractLinks", () => {
  test("puts verification links first and deduplicates", () => {
    const html = `
      <a href="https://acme.test/blog">Blog</a>
      <a href="https://acme.test/verify?token=abc&amp;user=1">Verify email</a>
      <a href="https://acme.test/blog">Blog again</a>`;
    expect(extractLinks(html, null)).toEqual([
      { url: "https://acme.test/verify?token=abc&user=1", isVerification: true },
      { url: "https://acme.test/blog", isVerification: false },
    ]);
  });

  test("finds bare URLs in plain text and trims trailing punctuation", () => {
    expect(extractLinks(null, "Confirm here: https://acme.test/confirm/123.")).toEqual([
      { url: "https://acme.test/confirm/123", isVerification: true },
    ]);
  });

  test("drops non-http schemes, unsubscribe links and images", () => {
    const html = `
      <a href="javascript:alert(1)">x</a>
      <a href="data:text/html,hi">x</a>
      <a href="https://acme.test/unsubscribe?id=1">x</a>
      <img src="https://acme.test/logo.png"><a href="https://acme.test/logo.png">x</a>`;
    expect(extractLinks(html, null)).toEqual([]);
  });

  test("caps the number of links", () => {
    const html = Array.from({ length: 50 }, (_, index) => `<a href="https://acme.test/p/${index}">x</a>`).join("");
    expect(extractLinks(html, null)).toHaveLength(20);
  });
});
