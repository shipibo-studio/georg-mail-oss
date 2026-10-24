import DOMPurify from "dompurify";
import { describe, expect, test } from "vitest";
import { emailContentSecurityPolicy, prepareEmailDocument, SanitizerUnavailableError } from "../src/lib/email-html";

const blocked = { allowRemoteImages: false };

function bodyOf(document: string): string {
  return document.slice(document.indexOf("<body>"));
}

describe("prepareEmailDocument", () => {
  test.each([
    ["a script", "<p>Hi</p><script>alert(1)</script>", /<script/i],
    ["an event handler", '<img src="data:image/png;base64,AA" onerror="alert(1)">', /onerror/i],
    ["a javascript: link", '<a href="javascript:alert(1)">x</a>', /javascript:/i],
    ["a data: link", '<a href="data:text/html,<script>alert(1)</script>">x</a>', /href="data:/i],
    ["a form", '<form action="https://evil.test"><input name="password"></form>', /<form|<input/i],
    ["an embedded frame", '<iframe src="https://evil.test"></iframe>', /<iframe/i],
    ["an object", '<object data="https://evil.test/x.swf"></object>', /<object/i],
    ["a meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">', /refresh/i],
    ["a base override", '<base href="https://evil.test/">', /evil\.test/],
    ["a remote stylesheet", '<link rel="stylesheet" href="https://evil.test/x.css">', /<link/i],
    ["an SVG script", "<svg><script>alert(1)</script></svg>", /<script/i],
    ["an SVG event handler", '<svg><a xlink:href="#" onclick="alert(1)">x</a></svg>', /onclick/i],
    ["a srcset tracker", '<img src="data:image/png;base64,AA" srcset="https://track.test/p.png 1x">', /srcset/i],
    ["a data attribute", '<p data-instructions="ignore previous">x</p>', /data-instructions/i],
  ])("removes %s", (_case, html, forbidden) => {
    expect(bodyOf(prepareEmailDocument(html, blocked).document)).not.toMatch(forbidden);
  });

  test("starts with its own policy, before anything from the email", () => {
    const { document } = prepareEmailDocument("<style>p{color:red}</style><p>Hi</p>", blocked);
    const policyAt = document.indexOf("Content-Security-Policy");
    expect(policyAt).toBeGreaterThan(0);
    expect(policyAt).toBeLessThan(document.indexOf("p{color:red}"));
    expect(document).toContain(emailContentSecurityPolicy(blocked));
    expect(document).toContain('<meta name="referrer" content="no-referrer">');
  });

  test("keeps the email's own styles and content", () => {
    const html =
      "<html><head><style>.brand{color:#123456}</style></head><body><h1 class='brand'>Hola</h1></body></html>";
    const { document } = prepareEmailDocument(html, blocked);
    expect(document).toContain(".brand{color:#123456}");
    expect(document).toContain("Hola");
  });

  test("opens links in a new tab without a referrer", () => {
    const { document } = prepareEmailDocument('<a href="https://acme.test/verify">Verify</a>', blocked);
    expect(document).toMatch(
      /<a href="https:\/\/acme\.test\/verify" target="_blank" rel="noopener noreferrer nofollow">/,
    );
  });

  test("keeps mailto links", () => {
    expect(prepareEmailDocument('<a href="mailto:a@b.test">a</a>', blocked).document).toContain(
      'href="mailto:a@b.test"',
    );
  });

  test.each([
    ["a remote image", '<img src="https://track.test/open.gif">', true],
    ["a protocol-relative image", '<img src="//track.test/open.gif">', true],
    ["a remote CSS background", '<div style="background:url(https://track.test/bg.png)">x</div>', true],
    ["a remote image in a style block", "<style>p{background-image:url('https://t.test/a.png')}</style><p>x</p>", true],
    ["only inline images", '<img src="data:image/png;base64,AA">', false],
    ["plain text", "<p>Hello</p>", false],
  ])("reports %s as remote content: %s", (_case, html, expected) => {
    expect(prepareEmailDocument(html, blocked).hasRemoteContent).toBe(expected);
  });

  test("fails closed when the sanitizer cannot run", () => {
    const supported = Object.getOwnPropertyDescriptor(DOMPurify, "isSupported");
    Object.defineProperty(DOMPurify, "isSupported", { value: false, configurable: true });
    try {
      expect(() => prepareEmailDocument("<script>alert(1)</script>", blocked)).toThrow(SanitizerUnavailableError);
    } finally {
      if (supported) Object.defineProperty(DOMPurify, "isSupported", supported);
    }
  });

  test("survives empty and broken HTML", () => {
    expect(prepareEmailDocument("", blocked).document).toContain("<body></body>");
    expect(prepareEmailDocument("<div><p>unclosed", blocked).document).toContain("unclosed");
  });
});

describe("emailContentSecurityPolicy", () => {
  test("blocks remote images until they are allowed, and never allows scripts or requests", () => {
    const strict = emailContentSecurityPolicy({ allowRemoteImages: false });
    const loose = emailContentSecurityPolicy({ allowRemoteImages: true });
    expect(strict).toContain("img-src data: cid:;");
    expect(strict).not.toContain("https:");
    expect(loose).toContain("img-src data: cid: https:");
    for (const policy of [strict, loose]) {
      expect(policy).toContain("default-src 'none'");
      expect(policy).not.toContain("script-src");
      expect(policy).not.toContain("connect-src");
    }
  });
});
