import { test as base, expect, type Page } from "@playwright/test";

interface Safety {
  /** Content-Security-Policy violations in the app itself (the email frame reports its own). */
  violations(): Promise<string[]>;
  /** Requests that tried to leave localhost: they are blocked, and recorded here. */
  externalRequests: string[];
}

export const test = base.extend<{ safety: Safety }>({
  safety: [
    async ({ page, request }, use) => {
      await request.post("/dashboard/api/__mock/reset");
      const externalRequests: string[] = [];
      await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() => {
        const found: string[] = [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations = found;
        document.addEventListener("securitypolicyviolation", (event) =>
          found.push(`${event.violatedDirective} ${event.blockedURI}`),
        );
      });
      const violations = () =>
        page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
      await use({ externalRequests, violations });
      // Parsing an email's HTML inertly (to sanitize it) makes Chrome check its inline event
      // handlers against the policy, which refuses them: that report is the policy working.
      // Anything else means the app itself broke its Content-Security-Policy.
      const unexpected = (await violations()).filter((violation) => !violation.startsWith("script-src-attr "));
      expect(unexpected).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openInbox(page: Page) {
  await page.goto("/dashboard/inbox");
  await expect(page.locator("button.msg").first()).toBeVisible();
}

export function row(page: Page, text: string) {
  return page.locator("button.msg", { hasText: text });
}

/** Settings → Mailbox, the tab of what is set up once: addresses, import, updates and signing out. */
export async function openMailboxTab(page: Page) {
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Mailbox" }).click();
  return settings;
}
