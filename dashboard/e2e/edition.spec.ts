// The mail client on its own: no workspace in the sidebar or ⌘K, workspace links open the inbox,
// and Notifications offers only the registered email.
import { expect, openInbox, test } from "./fixtures";

test("the sidebar has only mail and the account", async ({ page }) => {
  await openInbox(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator(".section-title")).toHaveText(["Mail", "Account"]);
  for (const name of ["Projects", "API keys", "MCP", "Webhooks", "Notify", "Activity"]) {
    await expect(sidebar.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
});

test("a workspace link opens the inbox", async ({ page }) => {
  for (const path of ["projects", "keys/new", "mcp", "webhooks", "notify", "activity"]) {
    await page.goto(`/dashboard/${path}`);
    await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  }
});

test("⌘K offers no workspace destination or action", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("project");
  await expect(palette.getByRole("option")).toHaveText([/^Search mail for/]);
});

test("Notifications show the registered email and no Slack", async ({ page }) => {
  await page.goto("/dashboard/notifications");
  await expect(page.locator("p.registered-email")).toHaveText("owner@example.org");
  await expect(page.getByRole("switch", { name: "Forward a copy" })).toBeVisible();
  await expect(page.getByText("Slack", { exact: false })).toHaveCount(0);
});
