import { describe, expect, test } from "vitest";
import { htmlToText } from "../../src/worker/email/html-to-text";

describe("htmlToText", () => {
  test("drops scripts and styles, keeps line breaks and decodes entities", () => {
    const html =
      "<style>p{}</style><script>alert(1)</script><p>Your code is&nbsp;<b>482913</b></p><p>Thanks &amp; bye</p>";
    expect(htmlToText(html)).toBe("Your code is 482913\nThanks & bye");
  });

  test("decodes named, decimal and hexadecimal entities, and keeps unknown or invalid ones", () => {
    expect(htmlToText("&lt;code&gt; &#52;&#56;&#50; &#x39;&#x31;&#x33; &copy; &#9999999;")).toBe(
      "<code> 482 913 &copy; &#9999999;",
    );
  });

  test("removes head, style and script elements in any case", () => {
    expect(htmlToText("<HEAD><title>t</title></HEAD><STYLE>x</STYLE><p>Hello</p><Script>y</sCript>")).toBe("Hello");
  });

  test("handles unclosed script tags", () => {
    expect(htmlToText("<p>Code 123456</p><script>never closed <p>hidden</p>")).toBe("Code 123456");
  });

  test("treats a missing closing bracket on a removed element as the end of the document", () => {
    expect(htmlToText("<p>Before</p><style>p{} </style")).toBe("Before");
  });

  test("collapses blank lines", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  test("keeps text that only looks like the start of a tag", () => {
    expect(htmlToText("a < b and 3 <4 then <b>bold</b>")).toBe("a < b and 3 <4 then bold");
  });

  // Quadratic scans would make these take seconds; linear processing finishes in milliseconds.
  test.each([
    ["many unclosed styles", "<style".repeat(30_000)],
    ["many scripts and no styles", "<script>x</script>".repeat(10_000)],
    ["long attribute-like runs", `<a ${"x".repeat(150_000)}`],
    ["a flood of opening brackets", "<".repeat(250_000)],
    ["repeated unclosed anchors", "<a ".repeat(80_000)],
  ])("stays linear on hostile input: %s", (_name, html) => {
    expect(() => htmlToText(html)).not.toThrow();
  });
});
