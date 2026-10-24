import { exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { DASHBOARD_CONTENT_SECURITY_POLICY } from "../../src/worker/dashboard/dashboard-assets";
import { BASE_URL } from "../mail-helpers";

const get = (path: string) => exports.default.fetch(new Request(`${BASE_URL}${path}`, { redirect: "manual" }));

describe("dashboard app", () => {
  test("redirects the bare path to the app root", async () => {
    const response = await get("/dashboard");
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/dashboard/");
  });

  test.each(["/dashboard/", "/dashboard/inbox", "/dashboard/mailbox/msg_abc123", "/dashboard/sent/"])(
    "serves the app shell for %s with a strict policy",
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(await response.text()).toContain("<!doctype html>");
      expect(response.headers.get("Content-Security-Policy")).toBe(DASHBOARD_CONTENT_SECURITY_POLICY);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
    },
  );

  test("the policy forbids scripts from elsewhere, framing and form posts", () => {
    expect(DASHBOARD_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(DASHBOARD_CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(DASHBOARD_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(DASHBOARD_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
  });

  test("a missing file is a 404 that is not cached forever", async () => {
    const response = await get("/dashboard/assets/missing-abc123.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  test("unknown dashboard API routes never fall back to the app shell", async () => {
    const response = await get("/dashboard/api/unknown");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("routes outside the dashboard are not given its page policy", async () => {
    const response = await get("/not-the-dashboard");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});
